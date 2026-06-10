# Background Service Worker Design

## Summary

Wire up the extension's background service worker to queue videos and generate summaries synchronously. This is the MVP approach — a future async processing pipeline will replace it.

## Core Flow

When a user adds a video (popup button, content script, or context menu):

1. **Queue** — `POST /api/queue` with the video URL → creates a `pending` row
2. **Process** — `POST /api/queue/:id/process` → fetches transcript, calls Claude, updates row to `completed` or `failed`

Both steps are called by the background worker's `queueAndProcess()` helper. The response includes the completed summary.

## Features

### Single video queue + summarize

- Content script detects video → user clicks "Add" in popup → popup sends `ADD_TO_QUEUE` → background queues + processes
- Background responds with the final summary or error

### Context menu

- "Add to Cliphy" context menu item on YouTube watch pages
- Registered via `browser.runtime.onInstalled` → `browser.contextMenus.create()`
- On click: extract video URL from tab → queue + process
- Requires `contextMenus` permission

### Auth delegation

Already implemented. Background handles `SIGN_IN` / `SIGN_OUT` messages.

## Deferred

- **Batch tabs** (queue all open YouTube tabs) — deferred to async processing milestone
- **Desktop notifications** — rethink later
- **Queue polling / SSE** — not needed with synchronous processing

## Error Handling

| Scenario                            | Behavior                                        |
| ----------------------------------- | ----------------------------------------------- |
| Not authenticated                   | Return error, popup prompts sign-in             |
| API unreachable                     | Return error, item stays `pending`              |
| Summarize fails                     | Server updates row to `failed` with error       |
| Duplicate video                     | Return existing summary (409 from API)          |
| Rate limit hit                      | Return error with "daily limit reached"         |
| Service worker killed mid-summarize | Item stays `pending`/`processing`, user retries |

## State

No in-memory state. API is source of truth. If service worker restarts, popup fetches fresh data.

## Shared Code

`extractVideoId` moved from server to `@cliphy/shared` for reuse by both server and extension.

## Files Changed

| File                                             | Change                                        |
| ------------------------------------------------ | --------------------------------------------- |
| `packages/shared/src/utils.ts`                   | New — `extractVideoId`                        |
| `packages/shared/src/constants.ts`               | Added `API_ROUTES.QUEUE.PROCESS`              |
| `apps/server/src/routes/queue.ts`                | Import from shared, added `POST /:id/process` |
| `apps/server/src/routes/__tests__/queue.test.ts` | Added 3 process endpoint tests                |
| `apps/extension/lib/api.ts`                      | Added `processQueueItem()`                    |
| `apps/extension/entrypoints/background.ts`       | Rewritten — queue+process flow, context menu  |
| `apps/extension/wxt.config.ts`                   | Added `contextMenus` permission               |
