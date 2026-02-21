# Async Processing Architecture Design

## Summary

Replace the synchronous `POST /api/queue/:id/process` endpoint with an Inngest-powered async pipeline. When a video is queued, the API fires an Inngest event. Inngest calls back into a `/api/inngest` route on Vercel to execute the job in durable steps. The extension subscribes to Supabase Realtime for instant row-change notifications.

## Stack

- **Job queue:** Inngest (serverless, Vercel-native, 50K free runs/mo)
- **Status updates:** Supabase Realtime (WebSocket subscription on summaries table)

## Data Flow

```
Extension -> POST /api/queue (creates pending row + fires Inngest event, returns immediately)
          -> Supabase Realtime subscription on summaries table

Inngest  -> calls /api/inngest -> step 1: fetch transcript (500ms-3s)
                                -> step 2: call Claude (3-8s)
                                -> step 3: save result to DB (<100ms)

DB row changes -> Supabase Realtime -> Extension gets notified instantly
```

## Inngest Function

Single function with three durable steps. Each step runs independently and retries on failure without re-running previous steps.

- **Event:** `video/summarize.requested`
- **Payload:** `{ queueItemId, videoId, videoTitle, userId }`
- **Steps:** fetch-transcript, generate-summary, save-result
- **Retries:** 3x per step with exponential backoff
- **Concurrency:** Capped at 1-2 concurrent jobs per user
- **Non-retriable errors:** Transcript unavailable, invalid video ID (use `NonRetriableError`)

Served via single Hono route at `/api/inngest` using `inngest/hono` adapter.

## Extension Changes

- `queueAndProcess()` simplifies to just `addToQueue()` (no more calling processQueueItem)
- Background worker subscribes to Supabase Realtime filtered by `user_id`
- On row UPDATE (status changes to completed/failed), relays to popup via `runtime.sendMessage`
- If service worker gets killed, subscription drops; popup fetches fresh state from API on next open

## Server Changes

- Add Inngest client + summarize-video function with 3 durable steps
- Add `/api/inngest` Hono route (GET + PUT + POST)
- Modify `POST /api/queue` to fire Inngest event after creating the row
- Remove `POST /api/queue/:id/process` endpoint

## Shared Changes

- Remove `API_ROUTES.QUEUE.PROCESS`

## Database Changes

- Add `retry_count` column (integer, default 0) to summaries table
- Enable Supabase Realtime on summaries table (dashboard setting)

## Error Handling

| Scenario                 | Behavior                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| Transcript not available | Step 1 throws NonRetriableError -> row set to `failed`. No retries.    |
| Claude API rate limit    | Step 2 retries 3x with exponential backoff.                            |
| Claude returns bad JSON  | Step 2 retries (existing inline retry + Inngest retries).              |
| Inngest down             | Row stays `pending`. User can retry later.                             |
| Service worker killed    | Realtime subscription drops. Popup fetches fresh state on next open.   |
| Duplicate video queued   | 409 from POST /api/queue (unchanged).                                  |
| Vercel function timeout  | Not a concern -- each Inngest step is a separate HTTP call, under 10s. |

## What Stays the Same

- Queue add flow, auth, context menu, rate limiting
- All existing endpoints except `/process`
- Status lifecycle: pending -> processing -> completed/failed
- summary_json, error_message, soft-delete, all existing indexes

## Unlocks

- **Batch tabs:** Fire N Inngest events, each processes independently
- **Longer videos:** No timeout pressure since steps are durable
- **Better reliability:** Independent step retries, no lost work

## Deferred

- Batch tabs UI (separate task)
- Desktop notifications on completion
- Priority queue / paid tier faster processing
