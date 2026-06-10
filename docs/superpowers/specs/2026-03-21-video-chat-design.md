---
title: "Video Chat — Converse with AI on a Video Summary"
date: 2026-03-21
---

# Video Chat — Converse with AI on a Video Summary

**Date:** 2026-03-21
**Status:** Approved

## Summary

Pro users can chat with AI about a completed video summary. The summary detail view gets a tabbed interface (Summary | Chat). The AI uses the video's transcript + existing summary as context, auto-detects whether the user is asking a question or requesting a summary update, and responds with structured output accordingly.

## Requirements

- **Pro-only**: Chat tab only rendered for Pro users
- **Completed summaries only**: Chat tab hidden for pending/processing/failed summaries
- **Ephemeral conversations**: Messages stored in React state only — no DB persistence
- **Non-streaming**: Full response returned, no SSE/streaming

## UI Design

### Tab Bar

- Two tabs below the top bar: **Summary** | **Chat**
- Summary tab: existing content (TL;DR, Highlights, Jump To, Context, tags, export bar)
- Chat tab: full-height conversation view
- Default to Summary tab on open
- Tab state is local — switching back to Summary preserves chat state in memory

### Chat Tab Layout

- Scrollable message area taking available height
- Messages styled as chat bubbles:
  - User messages: right-aligned, dark background (`#222`)
  - AI messages: left-aligned, neon-tinted background (`#e040fb22`)
- Fixed input bar at bottom: text input + Send button
- Empty state: placeholder text like "Ask anything about this video..."
- Loading state: typing indicator / spinner in AI bubble area while waiting for response

### Summary Update Proposals

When the AI detects the user wants to modify the summary:

- AI response renders as a chat bubble containing:
  - Explanation text (e.g. "Here's a more technical version:")
  - Highlighted block showing the proposed new text
  - Two buttons: "Apply to summary" / "Keep original"
- "Apply to summary" calls `PATCH /api/summaries/:id` to update `summary_json` in DB, then refreshes the Summary tab content
- A dot badge appears on the Summary tab after applying to indicate it changed
- "Keep original" dismisses the proposal — the chat message stays but buttons disappear

## API Design

### `POST /api/summaries/:id/chat`

**Auth:** Required, Pro-only (`requirePro(PRO_FEATURES.VIDEO_CHAT)`)

**Request:**

```json
{
  "messages": [
    { "role": "user", "content": "What did they say about X?" },
    { "role": "assistant", "content": "They explained that..." },
    { "role": "user", "content": "Make the TL;DR shorter" }
  ]
}
```

The `messages` array contains the full ephemeral conversation history. The server prepends the system prompt with transcript + summary context.

**Response:**

```json
{
  "type": "chat",
  "content": "The video discusses X at timestamp 4:32..."
}
```

Or for update requests:

```json
{
  "type": "update",
  "content": "Here's a shorter version of the TL;DR:",
  "updatedSection": "summary",
  "updatedSummaryJson": {
    /* full SummaryJson with the modified field */
  }
}
```

**`updatedSection`** indicates which part changed: `"summary"` (TL;DR), `"keyPoints"`, `"timestamps"`, or `"contextSection"`.

**Validation:**

- `messages` array required, non-empty, max 50 messages (prevent abuse)
- Each message must have `role` ("user" | "assistant") and `content` (string, non-empty)
- Summary must exist, belong to the user, and have `status === "completed"`
- Summary must have a `transcript` (older summaries created before transcript persistence won't have one)

**Server-side error handling:**

- `APIConnectionError` → return 503 with `{ error: "AI service temporarily unavailable", code: "AI_UNAVAILABLE" }`
- `APIError` 429/500/503 → return 503 with same message
- `APIError` 400/401 → return 500 with `{ error: "AI service error", code: "AI_ERROR" }`
- JSON parse failure → return 500 with `{ error: "Failed to process response. Try again." }`

### `PATCH /api/summaries/:id` (new route)

**Auth:** Required (any plan — used by chat but useful standalone)

**Request:**

```json
{
  "summary_json": {
    /* full SummaryJson */
  }
}
```

**Behavior:** Updates the `summary_json` column for the given summary. Only the owner can update. Returns the updated summary via `toSummary()`.

**Validation:** Must have `summary` (string), `keyPoints` (string[]), `timestamps` (string[]). Optional: `contextSection`, `truncated`, `actionItems` (legacy, accepted but not required).

**Response:**

```json
{
  "summary": {
    /* full Summary object via toSummary() */
  }
}
```

## Shared Constants

Add to `packages/shared/src/constants.ts`:

- `PRO_FEATURES.VIDEO_CHAT` — feature gate key for chat endpoint
- `API_ROUTES.SUMMARIES.CHAT(id)` — `/api/summaries/${id}/chat`
- `API_ROUTES.SUMMARIES.UPDATE(id)` — `/api/summaries/${id}` (PATCH)

## AI Design

### System Prompt

The chat system prompt provides:

- The video's transcript (full text)
- The current summary JSON (so the AI knows what exists)
- Instructions on response format (JSON with `type` field)
- Intent detection rules:
  - Questions about content → `type: "chat"`
  - Requests to modify/rewrite/shorten/expand summary sections → `type: "update"` with full modified `summaryJson`
- Instruction to reference timestamps from the transcript when relevant
- Prompt injection guard (same pattern as summarizer)

### Model

Same as summarizer: `claude-sonnet-4-6`. Temperature 0.3 for consistency.

- `type: "chat"` responses: `max_tokens: 2048`
- `type: "update"` responses: `max_tokens: 4096` (full `SummaryJson` can be large)

Since the AI determines the type, use `max_tokens: 4096` for all chat calls to ensure update responses aren't truncated.

### Context Window Management

- Transcript can be long (up to 100k chars ≈ 25k tokens after truncation)
- Conversation history grows with each turn (max 50 messages ≈ 6k tokens)
- System prompt + summary JSON ≈ 2k tokens
- Total worst case: ~33k tokens — well within `claude-sonnet-4-6`'s 200k context window
- No transcript truncation needed in practice, but if transcript + history exceeds 150k tokens, truncate transcript to first 60k + last 40k chars

### Vercel Timeout

Vercel functions are configured with `maxDuration: 60` (60 seconds) in `scripts/build-vercel.sh`. A synchronous Claude call for a chat response typically takes 5-15 seconds — well within the limit.

## Transcript Persistence (Prerequisite)

### Changes to `summarize-video.ts`

In the `fetch-transcript` step, the transcript text is already available. Modify the `save-result` step to also write `transcript` to the DB:

```ts
// In save-result step
await supabase
  .from("summaries")
  .update({ status: "completed", summary_json: summaryJson, transcript })
  .eq("id", summaryId);
```

The `transcript` variable is returned from step 1 (`text` field) and is in scope for step 3. Note: Inngest serializes step return values between steps — the transcript (up to 100k chars) is already serialized this way today since step 2 receives it from step 1. No additional overhead.

### Backward Compatibility

Summaries created before this change won't have a transcript. The chat endpoint should check for `transcript` and return a clear error if it's missing: `"Chat is not available for this summary. Try re-summarizing to enable chat."` The UI shows this as an inline message instead of the chat input, with a re-summarize button.

## Error Handling

- **No transcript**: Show message "Chat not available for this summary. Re-summarize to enable." with a re-summarize button
- **API error (500/503, network)**: Show error text below the chat input, don't clear the input so user can retry
- **Rate limit (429)**: Show "You've reached your chat limit. Try again later."
- **AI unavailable (503 with `AI_UNAVAILABLE`)**: Show "AI is temporarily unavailable. Try again in a moment."
- **JSON parse failure**: Show "Something went wrong. Try again."

## Data Flow

1. User opens a completed summary → Summary tab shown by default
2. User clicks Chat tab → chat view renders with empty state
3. User types message, clicks Send
4. Extension calls `POST /api/summaries/:id/chat` with `{ messages: [...history, newMessage] }`
5. Server loads transcript + summary_json from DB
6. Server builds system prompt with context, appends conversation, calls Claude
7. Claude returns structured JSON response
8. Server parses response, returns to client
9. Client appends AI response to local state, renders as chat bubble or update proposal
10. If update proposal accepted → `PATCH /api/summaries/:id` with new summary_json → refresh Summary tab

## Extension Client

### New API Functions

```ts
// api.ts
export async function chatWithSummary(id: string, messages: ChatMessage[]) {
  return request<ChatResponse>(API_ROUTES.SUMMARIES.CHAT(id), {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function updateSummaryJson(id: string, summaryJson: SummaryJson) {
  return request<{ summary: Summary }>(API_ROUTES.SUMMARIES.UPDATE(id), {
    method: "PATCH",
    body: JSON.stringify({ summary_json: summaryJson }),
  });
}
```

### New Types

```ts
// types.ts
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  type: "chat" | "update";
  content: string;
  updatedSection?: "summary" | "keyPoints" | "timestamps" | "contextSection";
  updatedSummaryJson?: SummaryJson;
}
```

## Scope

### In Scope

- Tab UI (Summary / Chat) in SummaryDetail for Pro users with completed summaries
- `POST /api/summaries/:id/chat` endpoint with structured AI response
- `PATCH /api/summaries/:id` endpoint for applying summary updates
- Chat system prompt with transcript + summary context
- AI intent detection (chat vs update)
- Update proposal UI with Apply/Keep buttons in chat
- Transcript persistence in summarize-video Inngest function
- Backward compat handling for summaries without transcripts
- `PRO_FEATURES.VIDEO_CHAT` constant and `API_ROUTES` entries

### Out of Scope

- Persisted conversation history (DB table for messages)
- Streaming responses
- Free tier access
- Chat on pending/processing/failed summaries
- Chat-specific rate limiting (uses existing Pro plan limits for now)
- Cliphub (summaries.html) integration — sidepanel only for v1
