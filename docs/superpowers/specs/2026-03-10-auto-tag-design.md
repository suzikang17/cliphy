---
title: "Auto-Tag Feature Design"
date: 2026-03-10
---

# Auto-Tag Feature Design

**Date:** 2026-03-10
**Status:** Draft
**Gate:** Pro-only

## Overview

AI-powered tag suggestions for summaries. Users can auto-tag a single summary or select multiple summaries and auto-tag them together. The AI picks from the user's existing tags and suggests new ones when nothing fits.

## User Flows

### Single-summary auto-tag

1. User clicks ✨ Auto-tag button on a summary card (next to the existing `+ tag` button)
2. Extension calls `POST /api/summaries/:id/auto-tag`
3. Suggestion panel appears inline on that card:
   - Existing tags shown in green, pre-checked
   - New tag suggestions shown with a "NEW" badge, pre-checked
   - Each tag is toggleable (click to check/uncheck)
   - "Apply selected" and "Dismiss" buttons
4. User toggles tags and clicks Apply → tags are written via existing `PATCH /api/summaries/:id/tags`

### Multi-select + auto-tag

1. Hovering a summary card reveals a checkbox on the left edge
2. Checking one card activates selection state:
   - All cards show checkboxes
   - Unselected cards dim slightly
   - Sticky action bar slides in at the bottom of the list
3. Action bar contains:
   - Left: "{n} selected · Select all · Clear"
   - Right: "✨ Auto-tag" and "Delete" buttons
4. Clicking ✨ Auto-tag calls `POST /api/summaries/auto-tag/bulk` with selected IDs
5. Results panel shows per-video suggestions (same tag UI as single — existing green, new with badge, toggleable)
6. "Apply all" writes tags for all summaries, "Dismiss" cancels

### Selection behavior details

- Hover card → checkbox fades in on left
- First check → all checkboxes become visible, action bar appears
- Clear all / deselect last → checkboxes hide, action bar disappears, back to normal
- Clicking a card body still navigates to detail view (checkbox area is a separate click target)
- "Select all" selects all currently loaded/visible summaries (not the full account — just what's on screen)

## API

### `POST /api/summaries/:id/auto-tag`

Single summary auto-tag. Pro-only (use `requirePro` middleware).

**Request:** No body needed — server fetches everything from the summary ID.

**Server logic:**

1. Fetch summary row (needs `summary_json`) — return 400 if summary has no content (status `pending` or `failed`)
2. Fetch user's existing tags via `GET /api/summaries/tags` logic (aggregate from all summaries)
3. Call Claude with summary content + existing tags
4. Return suggestions

**Response:**

```json
{
  "existing": ["cooking", "recipe"],
  "new": ["italian"]
}
```

**Error cases:**

- Summary not found or not owned by user → 404
- Summary has no `summary_json` (pending/failed) → 400 `{ "error": "Summary not ready for auto-tagging" }`
- User has no existing tags → still works, AI will only suggest new tags

### `POST /api/summaries/auto-tag/bulk`

Bulk auto-tag for multiple summaries. Pro-only.

**Route ordering:** Must be registered BEFORE `/:id/auto-tag` so Hono doesn't capture `auto-tag` as an `:id` param (same pattern as the existing `search` route).

**Request:**

```json
{
  "summaryIds": ["id1", "id2", "id3"]
}
```

**Validation:**

- `summaryIds` must be a non-empty array, max 20 items
- All IDs must belong to the authenticated user (filter silently — don't leak existence of others' summaries)
- Summaries without `summary_json` are skipped (included in response with `"skipped": true`)

**Server logic:**

1. Fetch all summary rows, filter to completed ones owned by user
2. Fetch user's existing tags (once, shared across all)
3. Call Claude once with all summaries + existing tags (single prompt, not per-summary)
4. Return per-summary suggestions

**Response:**

```json
{
  "suggestions": [
    { "summaryId": "id1", "existing": ["cooking", "recipe"], "new": ["italian"] },
    { "summaryId": "id2", "existing": ["cooking", "recipe"], "new": ["japanese"] },
    { "summaryId": "id3", "skipped": true }
  ]
}
```

**Limits:** Cap at 20 summaries per call to keep the prompt reasonable.

## AI Prompt

**Model:** Haiku (latest available) — this is classification, not generation. Fast and cheap. Verify current model ID at implementation time.

**Input:**

- Summary text (summary, key points, context section title)
- User's full existing tag list

**Instructions (system prompt):**

- Pick 1–5 existing tags that genuinely fit the content
- Suggest 0–2 new tags only if no existing tag covers a major theme
- New tags should match the style/casing of existing tags (lowercase, short)
- Return JSON: `{ "existing": [...], "new": [...] }`
- For bulk: return an array keyed by summary ID

**For bulk requests:** all summaries are included in a single prompt so the AI can see the full picture and create cohesive tags across videos.

**Token estimate:** ~200–500 input tokens per summary + ~50 for existing tags + ~30 output. Negligible cost.

## UI Components

### `AutoTagButton`

Small button rendered next to `+ tag` on each summary card in Cliphub. Only shown for Pro users.

- Idle: "✨ Auto-tag"
- Loading: spinner replacing the sparkle icon
- After results: replaced by inline `TagSuggestions` panel

### `TagSuggestions`

Inline panel showing AI-suggested tags for a summary.

- Each tag is a toggleable chip (checked by default)
- Existing tags: green background
- New tags: purple-ish background with "NEW" label
- Footer: "Dismiss" (text link) and "Apply selected" (primary button)
- Single-summary: applying calls existing `handleTagsChange` with merged tag array
- Bulk apply: calls `handleTagsChange` sequentially (not in parallel) to avoid race conditions on shared `allTags` state. Each call's optimistic update completes before the next starts.

### Card selection

- Checkbox: absolutely positioned on left edge of card, visible on hover or when any card is selected
- Selected state: card gets a highlighted border, checkbox is filled
- Unselected (when others are selected): card dims to ~70% opacity

### `SelectionActionBar`

Sticky bar at bottom of card list, appears when 1+ cards selected.

- Left side: "{n} selected" count, "Select all" link, "Clear" link
- Right side: "✨ Auto-tag" button, "Delete" button
- Slides in/out with a CSS transition

## Data Model

No schema changes. Auto-tag uses the existing `tags` column on `summaries`. The AI endpoints are suggestion-only — tags are applied through the existing `PATCH /api/summaries/:id/tags` endpoint.

## Pro Gating

- Both auto-tag endpoints use `requirePro` middleware (returns 402 with `code: "pro_required"`)
- Add `AUTO_TAG` to `PRO_FEATURES` in constants
- Extension hides ✨ Auto-tag button for free users (check `usage.plan`)
- No separate rate limit — Pro users can auto-tag freely

## File Changes

**Server:**

- `packages/shared/src/constants.ts` — add `AUTO_TAG` to `PRO_FEATURES`
- `apps/server/src/routes/summaries.ts` — add two new endpoints (register bulk route BEFORE `/:id` routes)
- `apps/server/src/services/auto-tag.ts` — new file: Claude call + prompt for tag suggestions
- `apps/server/src/lib/prompts.ts` — add auto-tag prompt templates

**Extension:**

- `apps/extension/lib/api.ts` — add `autoTagSummary()` and `autoTagBulk()` API client functions
- `apps/extension/components/AutoTagButton.tsx` — new component
- `apps/extension/components/TagSuggestions.tsx` — new component
- `apps/extension/components/SelectionActionBar.tsx` — new component
- `apps/extension/entrypoints/summaries/App.tsx` — add selection state, checkbox rendering, integrate new components

## Out of Scope

- Auto-tag in sidepanel (tags are already read-only there)
- Auto-tag on summary creation (future enhancement — promote to automatic if users like it)
- Tag management UI (rename, merge, delete tags globally)
- Free tier auto-tag (Pro-only for now)
