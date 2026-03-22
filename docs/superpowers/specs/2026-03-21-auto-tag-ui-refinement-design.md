# Auto-Tag UI Refinement Design

**Date:** 2026-03-21
**Status:** Approved
**Scope:** UI-only — no API or data model changes

## Problem

After bulk auto-tagging, AI suggestions appear as dashed chips crammed inline into the tag row of each summary card. They blend in with existing tags (same size, similar style), are easy to overlook, and give no visual signal that they're AI-generated or that existing vs. new suggestions differ.

## Solution

Replace the inline chip approach with a full-width green suggestion strip that attaches to the bottom of each card. Chips migrate one-by-one into the tag row on click, or all at once via "Add all".

## Interaction Design

### Suggestion strip (per card)

A green-tinted banner appears at the bottom of any card that has pending AI tag suggestions. It contains:

- **Label:** `✨ Add tags:`
- **Green chips** — tags the AI picked from the user's existing tag library (tags they don't yet have on this summary)
- **Purple chips with "new" badge** — tags the AI invented that don't exist anywhere in the user's library yet

**Click a chip** → `onApplyOne(tag)` fires (App.tsx merges with `summary.tags` and calls the API). The component removes that chip from its own internal state. Simultaneously, the parent prunes that tag from `autoTagResults` — both updates happen together; component internal state drives what's visible in the strip, parent state drives whether the strip renders at all. The tag appears in the tag row with a brief green highlight. If the strip's internal state becomes empty, it auto-dismisses.

**"Add all"** → `onApply(remainingTags)` fires, where `remainingTags` is only the suggestion tags remaining in the strip (not pre-merged with `currentTags` — App.tsx is responsible for merging). Strip dismisses.

**"✕"** → `onDismiss()` fires, strip closes with no tags added.

### Sticky bulk bar (unchanged)

The existing "✨ N summaries have pending suggestions · Apply all · Dismiss all" sticky bar at the bottom of the page is kept as-is. It remains a shortcut for users who want to accept everything across all cards at once without reviewing individually.

## Component Changes

### `TagSuggestions.tsx` — full rewrite

Current behavior: toggleable dashed chips inline in the tag row.

New behavior: a full-width strip rendered below the card's main content. Internal state tracks which chips remain (starts as all suggestions filtered against `currentTags`). Each click removes one chip from internal state and fires the apply callback.

**Deduplication:** The component filters `existing` against `currentTags` on init (as today), ensuring only tags not already on the summary are shown. The App.tsx handlers do not need to re-check — they trust the component showed only non-duplicate suggestions.

**Props interface:**

```ts
interface TagSuggestionsProps {
  existing: string[]; // AI-picked from user's existing tags (may include tags already on summary — component filters on init)
  new: string[]; // AI-invented tags not in user's library
  currentTags: string[]; // Tags already on this summary (used to filter existing on init)
  onApplyOne: (tag: string) => void; // Single chip clicked — receives just that tag
  onApply: (tags: string[]) => void; // "Add all" — receives only remaining suggestion tags (not merged with currentTags)
  onDismiss: () => void; // ✕ clicked
}
```

**Rendering:** Not inside the tag row flex container. Rendered as a sibling block element below the card's main flex row, inside the card wrapper `div`, with `onClick={(e) => e.stopPropagation()}` to prevent card navigation.

**Visual spec:**

- Background: `bg-green-50 dark:bg-green-950/30`
- Border top: `border-t border-green-200 dark:border-green-800`
- Padding: `px-3 py-2`
- Existing tag chips: white bg, green border (`border-green-300`), green text
- New tag chips: purple-tinted bg (`bg-purple-50`), purple border (`border-purple-300`), purple text, `new` badge inline
- Newly applied tag in tag row: briefly highlighted with green border + green bg, fades to normal after ~800ms
- Strip animates out when dismissed or emptied (simple fade or slide)

### `SummaryCard` in `summaries/App.tsx`

- Remove `<TagSuggestions>` from inside the tag row `flex-wrap` div (currently wrapped in a `<div className="contents">` at lines 890–901)
- Remove the `contents` wrapper entirely — it's no longer appropriate for a block-level strip
- Render `<TagSuggestions>` after the closing tag of the main `flex items-start gap-3` div, still inside the outer card `div`, wrapped in a plain `<div onClick={(e) => e.stopPropagation()}>` for click isolation
- Wire `onApplyOne` → `handleAutoTagApplyOne(s.id, tag)`
- Wire `onApply` → `handleAutoTagApplyAll(s.id, tags)` (see below)

### `summaries/App.tsx` — two new handlers

**Single chip apply** (new):

```ts
function handleAutoTagApplyOne(summaryId: string, tag: string) {
  const summary = summaries.find((s) => s.id === summaryId);
  if (!summary) return;
  handleTagsChange(summaryId, [...summary.tags, tag]);
  setAutoTagResults((prev) => {
    const next = new Map(prev);
    const result = prev.get(summaryId);
    if (!result) return prev;
    const remaining = {
      existing: result.existing.filter((t) => t !== tag),
      new: result.new.filter((t) => t !== tag),
    };
    if (remaining.existing.length === 0 && remaining.new.length === 0) {
      next.delete(summaryId);
    } else {
      next.set(summaryId, remaining);
    }
    return next;
  });
}
```

**"Add all" from strip** (new — replaces `handleAutoTagApply` for this call site):

```ts
function handleAutoTagApplyAll(summaryId: string, tags: string[]) {
  const summary = summaries.find((s) => s.id === summaryId);
  if (!summary) return;
  handleTagsChange(summaryId, [...summary.tags, ...tags]);
  setAutoTagResults((prev) => {
    const next = new Map(prev);
    next.delete(summaryId);
    return next;
  });
}
```

The existing `handleAutoTagApply` (used by the sticky bulk bar's "Apply all") remains unchanged — it already receives a pre-merged tag list from `handleApplyAllAutoTags` and passes it to `handleTagsChange` directly.

## Out of Scope

- Single-card `AutoTagButton` (✨ button on individual cards without selection) — separate feature, not changed here
- Sticky bulk bar changes — kept as-is
- Any API or server changes
- Tag suggestion behavior in the sidepanel (tags are read-only there)
