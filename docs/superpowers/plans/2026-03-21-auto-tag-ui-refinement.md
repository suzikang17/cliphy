# Auto-Tag UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline auto-tag suggestion chips (currently crammed into the tag row) with a full-width green suggestion strip at the bottom of each summary card, where chips can be applied one-by-one or all at once.

**Architecture:** `TagSuggestions.tsx` is fully rewritten as a bottom-of-card strip component. Its call site in `SummaryCard` is moved out of the tag row and into the card's outer div. Two new handlers in `summaries/App.tsx` (`handleAutoTagApplyOne` and `handleAutoTagApplyAll`) replace the existing `handleAutoTagApply` call site on the card.

**Tech Stack:** React, TypeScript, Tailwind CSS (v4 with CSS variable tokens), WXT Chrome extension

---

## File Map

| File                                           | Change                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `apps/extension/components/TagSuggestions.tsx` | Full rewrite — new strip UI and interaction model                |
| `apps/extension/entrypoints/summaries/App.tsx` | Add two handlers, update `SummaryCard` prop wiring and placement |

No new files. No server changes. No shared package changes.

---

## Task 1: Rewrite `TagSuggestions.tsx`

**Files:**

- Modify: `apps/extension/components/TagSuggestions.tsx`

The current component renders toggleable dashed chips inline in the tag row. Replace it entirely with a bottom-of-card strip.

**New props contract:**

- `existing: string[]` — AI-picked tags from user's library (component filters against `currentTags` on init)
- `new: string[]` — AI-invented tags not in user's library
- `currentTags: string[]` — tags already on the summary (used to deduplicate `existing` on init)
- `onApplyOne: (tag: string) => void` — called when a single chip is clicked
- `onApply: (tags: string[]) => void` — called with all remaining suggestion tags when "Add all" clicked
- `onDismiss: () => void` — called when ✕ clicked

**Interaction:**

- Internal state tracks which chips remain (initialized from props, filtered against `currentTags`)
- Clicking a chip: removes it from internal state, calls `onApplyOne(tag)`. If state becomes empty, component returns null (auto-dismisses).
- "Add all": calls `onApply(allRemainingTags)` then clears internal state
- "✕": calls `onDismiss()`

**Visual:**

- Strip container: `mt-2 border-t border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 flex items-center gap-1.5 flex-wrap`
- Label: `text-[10px] text-green-700 dark:text-green-400 font-bold mr-1 shrink-0` — text: `✨ Add tags:`
- Existing tag chips (green): `px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-white dark:bg-transparent border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 transition-colors`
- New tag chips (purple): `px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 hover:bg-purple-100 transition-colors`
- "new" badge inside purple chip: `ml-1 text-[8px] font-black opacity-70`
- "Add all" button: `ml-auto text-[10px] font-bold text-green-700 dark:text-green-400 hover:text-green-900 bg-transparent border-0 p-0 cursor-pointer shrink-0`
- "✕" button: `text-[10px] text-(--color-text-faint) hover:text-(--color-text-muted) bg-transparent border-0 p-0 cursor-pointer shrink-0`

- [ ] **Step 1: Rewrite `TagSuggestions.tsx`**

Replace the entire file with:

```tsx
import { useState } from "react";

interface TagSuggestionsProps {
  existing: string[];
  new: string[];
  currentTags: string[];
  onApplyOne: (tag: string) => void;
  onApply: (tags: string[]) => void;
  onDismiss: () => void;
}

interface Chip {
  tag: string;
  isNew: boolean;
}

export function TagSuggestions({
  existing,
  new: newTags,
  currentTags,
  onApplyOne,
  onApply,
  onDismiss,
}: TagSuggestionsProps) {
  const [chips, setChips] = useState<Chip[]>(() => [
    ...existing.filter((t) => !currentTags.includes(t)).map((tag) => ({ tag, isNew: false })),
    ...newTags.map((tag) => ({ tag, isNew: true })),
  ]);

  if (chips.length === 0) return null;

  function handleChipClick(tag: string) {
    setChips((prev) => prev.filter((c) => c.tag !== tag));
    onApplyOne(tag);
  }

  function handleAddAll() {
    const tags = chips.map((c) => c.tag);
    setChips([]);
    onApply(tags);
  }

  return (
    <div className="mt-2 border-t border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-green-700 dark:text-green-400 font-bold mr-1 shrink-0">
        ✨ Add tags:
      </span>
      {chips.map(({ tag, isNew }) =>
        isNew ? (
          <button
            key={tag}
            onClick={() => handleChipClick(tag)}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
          >
            {tag}
            <span className="ml-1 text-[8px] font-black opacity-70">new</span>
          </button>
        ) : (
          <button
            key={tag}
            onClick={() => handleChipClick(tag)}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-white dark:bg-transparent border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
          >
            {tag}
          </button>
        ),
      )}
      <button
        onClick={handleAddAll}
        className="ml-auto text-[10px] font-bold text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-200 bg-transparent border-0 p-0 cursor-pointer shrink-0 transition-colors"
      >
        Add all
      </button>
      <button
        onClick={onDismiss}
        className="text-[10px] text-(--color-text-faint) hover:text-(--color-text-muted) bg-transparent border-0 p-0 cursor-pointer shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /path/to/repo && pnpm --filter extension build 2>&1 | head -40
```

Expected: No TypeScript errors in `TagSuggestions.tsx` itself. There will be errors in `App.tsx` because the old props (`onApply` with merged tags) are now mismatched — that's expected and fixed in Task 2.

---

## Task 2: Add new handlers to `summaries/App.tsx`

**Files:**

- Modify: `apps/extension/entrypoints/summaries/App.tsx`

Add two new handlers inside the `App` function, after `handleAutoTagDismiss` (around line 223).

- [ ] **Step 1: Add `handleAutoTagApplyOne` after `handleAutoTagDismiss`**

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

- [ ] **Step 2: Add `handleAutoTagApplyAll` directly after `handleAutoTagApplyOne`**

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

- [ ] **Step 3: Verify the file compiles**

```bash
pnpm --filter extension build 2>&1 | head -40
```

Expected: Still errors in `CardList`/`SummaryCard` prop threading — fixed in Task 3.

---

## Task 3: Update prop threading in `CardList` and `SummaryCard`

**Files:**

- Modify: `apps/extension/entrypoints/summaries/App.tsx`

Three changes:

1. **`CardList` props** — replace `onAutoTagApply: (id: string, tags: string[]) => void` with two new props:
   - `onAutoTagApplyOne: (id: string, tag: string) => void`
   - `onAutoTagApplyAll: (id: string, tags: string[]) => void`

2. **`CardList` call site** (in `App`, around line 410) — replace:

   ```tsx
   onAutoTagApply = { handleAutoTagApply };
   ```

   with:

   ```tsx
   onAutoTagApplyOne = { handleAutoTagApplyOne };
   onAutoTagApplyAll = { handleAutoTagApplyAll };
   ```

3. **`SummaryCard` props** — same replacement: swap `onAutoTagApply` for `onAutoTagApplyOne` + `onAutoTagApplyAll`, and update the `TagSuggestions` wiring and placement (Task 4 handles placement; this task handles the prop interface).

- [ ] **Step 1: Update `CardList` props interface and call site**

In the `CardList` function signature (around line 638), replace:

```ts
onAutoTagApply: (id: string, tags: string[]) => void;
```

with:

```ts
onAutoTagApplyOne: (id: string, tag: string) => void;
onAutoTagApplyAll: (id: string, tags: string[]) => void;
```

In `CardList`'s destructure and pass-through to `SummaryCard` (around line 700), replace:

```tsx
onAutoTagApply={(tags) => onAutoTagApply(s.id, tags)}
```

with:

```tsx
onAutoTagApplyOne={(tag) => onAutoTagApplyOne(s.id, tag)}
onAutoTagApplyAll={(tags) => onAutoTagApplyAll(s.id, tags)}
```

In the `App` JSX that renders `<CardList>` (around line 410), replace:

```tsx
onAutoTagApply = { handleAutoTagApply };
```

with:

```tsx
onAutoTagApplyOne = { handleAutoTagApplyOne };
onAutoTagApplyAll = { handleAutoTagApplyAll };
```

- [ ] **Step 2: Update `SummaryCard` props interface**

In `SummaryCard`'s props interface (around line 725), replace:

```ts
onAutoTagApply?: (tags: string[]) => void;
```

with:

```ts
onAutoTagApplyOne?: (tag: string) => void;
onAutoTagApplyAll?: (tags: string[]) => void;
```

Update the destructure accordingly.

- [ ] **Step 3: Verify the file compiles**

```bash
pnpm --filter extension build 2>&1 | head -40
```

Expected: Errors only around the `<TagSuggestions>` call site inside `SummaryCard` — old props mismatch. Fixed in Task 4.

---

## Task 4: Relocate and rewire `<TagSuggestions>` in `SummaryCard`

**Files:**

- Modify: `apps/extension/entrypoints/summaries/App.tsx`

Currently `<TagSuggestions>` is rendered inside the tag row's `flex-wrap` div, wrapped in `<div className="contents">` (around lines 890–901). Move it outside the tag row and rewire to the new props.

- [ ] **Step 1: Remove old `TagSuggestions` from the tag row**

Find this block (around line 890) and delete it entirely:

```tsx
{
  autoTagResult && onAutoTagApply && onAutoTagDismiss && (
    <div onClick={(e) => e.stopPropagation()} role="presentation" className="contents">
      <TagSuggestions
        existing={autoTagResult.existing}
        new={autoTagResult.new}
        currentTags={s.tags}
        onApply={onAutoTagApply}
        onDismiss={onAutoTagDismiss}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add `<TagSuggestions>` after the main flex row, inside the card wrapper**

After the closing `</div>` of the `flex items-start gap-3` div (around line 903, just before the delete button), add:

```tsx
{
  autoTagResult && onAutoTagApplyOne && onAutoTagApplyAll && onAutoTagDismiss && (
    <div onClick={(e) => e.stopPropagation()}>
      <TagSuggestions
        existing={autoTagResult.existing}
        new={autoTagResult.new}
        currentTags={s.tags}
        onApplyOne={onAutoTagApplyOne}
        onApply={onAutoTagApplyAll}
        onDismiss={onAutoTagDismiss}
      />
    </div>
  );
}
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
pnpm --filter extension build 2>&1 | head -60
```

Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/components/TagSuggestions.tsx apps/extension/entrypoints/summaries/App.tsx
git commit -m "refactor auto-tag suggestions: bottom strip with per-chip apply"
```

---

## Task 5: Smoke test in browser

**Files:** None — manual verification only.

- [ ] **Step 1: Load the extension**

```bash
pnpm dev:extension
```

Load unpacked from `apps/extension/.output/chrome-mv3` in Chrome (`chrome://extensions`). Use Cmd+Shift+. in the file picker to show hidden dirs.

- [ ] **Step 2: Open Cliphub and bulk auto-tag**

1. Open `chrome-extension://<id>/summaries.html`
2. Select 2–3 completed summaries using the checkboxes
3. Click "✨ Auto-tag" in the action bar
4. Verify: green strips appear at the bottom of each selected card (not in the tag row)
5. Verify: existing tags appear as green chips, new AI tags as purple chips with "new" badge

- [ ] **Step 3: Test single chip apply**

1. Click one chip in a strip
2. Verify: chip disappears from strip, tag appears in tag row
3. Verify: if last chip, strip auto-dismisses

- [ ] **Step 4: Test "Add all"**

1. On a card with multiple suggestions, click "Add all"
2. Verify: all tags appear in tag row, strip disappears

- [ ] **Step 5: Test "✕" dismiss**

1. Click ✕ on a strip
2. Verify: strip dismisses, no tags added, card unchanged

- [ ] **Step 6: Test sticky "Apply all" bar still works**

1. After bulk auto-tag, the sticky bar at the bottom of the page should still show
2. Click "Apply all" — verify all pending suggestions are applied across all cards
3. Click "Dismiss all" — verify all strips disappear
