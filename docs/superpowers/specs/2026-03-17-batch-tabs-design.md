# Batch Tabs — Queue All Open YouTube Tabs

**Date:** 2026-03-17
**Status:** Approved

## Summary

Pro users can queue all open YouTube tabs at once from a compact button in the sidepanel header. Clicking opens an inline dropdown showing discovered tabs with checkboxes for cherry-picking, then a confirm button fires the batch request.

## Requirements

- **Pro-only**: Button only rendered when `user.plan === "pro"`
- **Conditional visibility**: Button only shown when there are YouTube watch tabs open that aren't already in the queue
- **No empty/free states**: Button is simply hidden when not applicable

## UI Design

### Entry Point

- Compact button in the sidepanel top bar, between the logo and user avatar
- Label: `⚡ All tabs` (or similar short label)
- Styled with the existing neon accent (border + background tint)

### Dropdown Panel

- Appears inline below the top bar, overlaying the queue list (queue list dims behind it)
- Header: "{N} YouTube tabs found" with "Select all" toggle
- List of tabs, each with:
  - Checkbox (pre-checked by default)
  - YouTube thumbnail (48×27px)
  - Video title (truncated)
  - Channel name and duration
- Footer: "Queue {N} videos" confirm button
- Clicking outside or pressing Escape closes the dropdown

### Tab Discovery

1. Query: `browser.tabs.query({ url: "*://www.youtube.com/watch*" })`
2. For each tab, use `browser.tabs.sendMessage(tab.id, { type: "GET_VIDEO_INFO" })` to fetch metadata — must target each tab individually by ID
3. Filter out live streams (`isLive === true`)
4. Filter out tabs whose `videoId` already exists in `summaries` array (exclude `failed` items — they can be re-queued, matching server behavior at `queue.ts:233`)
5. Filter out the current window's active tab (`{ active: true, currentWindow: true }`) since it's already shown as `CurrentVideoItem`

## Data Flow

1. User clicks "All tabs" button
2. Extension queries all YouTube watch tabs across all windows
3. For each tab, sends `GET_VIDEO_INFO` via `browser.tabs.sendMessage(tab.id, ...)` — skips tabs where the content script isn't available (try/catch per tab)
4. Filters out live streams, duplicates already in queue, and current active tab
5. If no tabs remain after filtering, button stays hidden (discovery runs on sidepanel mount and on tab changes)
6. Renders dropdown with results
7. User selects/deselects, clicks "Queue N videos"
8. Calls existing `addToQueueBatch()` → `POST /api/queue/batch`
9. On success: closes dropdown, refreshes queue list, shows inline status text briefly (e.g., "Queued 3 videos") in the dropdown area before it closes
10. On partial success (rate limited mid-batch): server adds as many as allowed (caps to `allowedCount`), returns 200 with `added` count — show "Queued X of Y videos"

## Technical Notes

### Existing Infrastructure

- `browser.tabs` permission already declared in `wxt.config.ts`
- `addToQueueBatch()` already exists in `api.ts` → `POST /api/queue/batch`
- `PRO_FEATURES.BATCH_QUEUE` constant already defined
- Content script already handles `GET_VIDEO_INFO` on all YouTube pages

### Content Script Considerations

- Content script may not be injected in tabs opened before the extension was installed/updated — wrap each `browser.tabs.sendMessage` in try/catch and skip failed tabs
- Tabs on YouTube but not on a `/watch` page are excluded by the URL query pattern
- Live streams filtered out client-side after `GET_VIDEO_INFO` response

### Batch Endpoint Behavior (verified)

The existing `POST /api/queue/batch` (queue.ts:186):

- Accepts `{ videos: [{ videoUrl }] }`, max 10 per batch
- Deduplicates within the batch and against DB (excludes `failed` items from dup check)
- Handles partial rate limiting: `increment_monthly_count_batch` returns how many are allowed, server caps the insert to that count
- Returns 429 only if zero are allowed; otherwise returns 200 with partial results
- Returns `{ summaries, added, skipped }` on success

No server changes needed.

### Rate Limiting

Each video counts against the monthly limit. The server handles partial adds atomically — if only 3 of 5 are allowed, it inserts 3 and returns `added: 3`. A 429 is only returned when the user has zero remaining quota.

## Error Handling

- **Tab message failure**: Skip tabs where content script isn't available (try/catch per `sendMessage`). Don't block the batch for one bad tab.
- **429 (zero quota)**: Show `RateLimitError` message in the dropdown — "Monthly limit reached". Don't close dropdown.
- **Other API error**: Show error text in the dropdown. Don't close on failure.
- **Partial add (rate limited mid-batch)**: Server returns 200 with reduced `added` count. Show "Queued X of Y" feedback before closing.

## Scope

### In Scope

- Top bar button with conditional visibility (Pro + queueable tabs exist)
- Inline dropdown with tab list and checkboxes
- Tab discovery via `browser.tabs.query` + per-tab `browser.tabs.sendMessage`
- Duplicate filtering against current queue (excluding failed items)
- Live stream filtering
- Batch queue via existing endpoint
- Success/error/partial feedback

### Out of Scope

- Context menu entry for batch
- Keyboard shortcut
- Selecting specific tabs from non-YouTube pages
- Changes to the batch API endpoint
- Free user upgrade prompt in dropdown
