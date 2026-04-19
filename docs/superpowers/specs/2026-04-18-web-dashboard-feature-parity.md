# Web Dashboard Feature Parity

**Goal:** Port all features from the extension's Cliphub page (`apps/extension/entrypoints/summaries/App.tsx`) into the web app dashboard and summary page. Rename "Your Summaries" to "Your Cliphub". Move two shared UI components to `packages/shared`.

---

## Shared Components (`packages/shared`)

### Changes to `packages/shared`

Add React support:

- `package.json`: add `"react": "^18"` as peer dep
- `tsconfig.json`: add `"jsx": "react-jsx"`, `"jsxImportSource": "react"`
- New file: `src/components/TagSuggestions.tsx` (moved from `apps/extension/components/TagSuggestions.tsx`)
- New file: `src/components/SelectionActionBar.tsx` (moved from `apps/extension/components/SelectionActionBar.tsx`)
- Export both from `src/index.ts`

### Update extension imports

Update `apps/extension/entrypoints/summaries/App.tsx` to import `TagSuggestions` and `SelectionActionBar` from `@cliphy/shared` instead of `../../components/`.

Delete the now-redundant files from `apps/extension/components/`.

---

## Web API (`apps/web/src/lib/api.ts`)

Add four missing functions (using the same `request()` pattern already in the file):

```ts
getAllTags()           → GET   API_ROUTES.TAGS.LIST
updateSummaryTags()   → PATCH API_ROUTES.SUMMARIES.TAGS(id)
autoTagSummary()      → POST  API_ROUTES.SUMMARIES.AUTO_TAG(id)
autoTagBulk()         → POST  API_ROUTES.SUMMARIES.AUTO_TAG_BULK
```

Import `AutoTagSuggestion`, `BulkAutoTagResponse`, `TagsResponse` from `@cliphy/shared`.

---

## Web Dashboard (`apps/web/src/pages/Dashboard.tsx`)

Full rewrite using the extension's summaries page as the reference implementation. Same sub-component pattern: `Header`, `Toolbar`, `CardList`, `SummaryCard`.

### State

```ts
summaries: Summary[]
usage: UsageInfo | null
allTags: string[]
filterTag: string | null
searchQuery: string
sortOrder: "newest" | "oldest"
loading: boolean
error: string | null
selectedIds: Set<string>
autoTagResults: Map<string, AutoTagSuggestion>
bulkAutoTagLoading: boolean
```

### Header component

- Title: "Your Cliphub" (not "Your Summaries")
- Tag filter chips below title — click to toggle filter, click active chip to clear
- Clicking the title when a filter is active clears all filters

### Toolbar component

- Search input (filters by video title + channel, client-side)
- Sort select: Newest / Oldest

### SummaryCard component

Replace the current `<Link>`-based card with a clickable `div` that calls `useNavigate` to `/summary/:id`. This allows hosting interactive elements (checkboxes, tag editing, delete button, TagSuggestions) inside without nested-link issues.

**Card features:**

- Thumbnail, title, channel, duration, relative date (existing)
- Inline tag chips with × to remove; `+ tag` dropdown picker on hover (existing tags only, filtered to unassigned)
- Checkbox top-right: hidden until hover OR any card is selected; selected state shows neon ring on card
- Delete button bottom-right: hover to reveal, second click to confirm (3s timeout)
- `TagSuggestions` panel (from shared) rendered below tag row when `autoTagResult` is set

**Tag mutations:** optimistic updates with rollback on failure, same as extension.

### CardList component

Empty states:

- No summaries at all: "No summaries yet" + install extension prompt
- Filters active, no matches: "No summaries tagged X" or "No summaries match your search" + Clear filters button

### Auto-tag flow

- `SelectionActionBar` (from shared) shown when `selectedIds.size > 0` and `isPro`
- Bulk auto-tag: calls `autoTagBulk(ids)`, populates `autoTagResults` map, clears selection
- Per-result: `TagSuggestions` renders on the card with apply-one, apply-all, dismiss
- Global banner (sticky, above action bar): "✨ N summaries have pending tag suggestions" + Apply all / Dismiss all buttons — shown when `autoTagResults.size > 0`

### Free plan banner

Shown below card list for free users:

> "Showing last 30 days. Upgrade to Pro for unlimited history, ✨ AI auto-tagging, and more."

Upgrade link calls `createCheckout()`.

### UsageBar

Keep the existing `UsageBar` component at the top — no change.

---

## Summary Page (`apps/web/src/pages/SummaryPage.tsx`)

### Tag editing section

Add below the video metadata block:

- Current tags displayed as chips with × to remove
- `+ tag` button (hover) opens dropdown of existing tags not yet on this summary
- Calls `updateSummaryTags()` with optimistic update + rollback

### Retry button

For summaries with `status === "failed"`, show a "Retry" button that calls `retryQueueItem(id)` and polls until `status === "completed" | "failed"` (3s interval, same as extension).

### Auto-tag (Pro)

For completed summaries, show a "✨ Auto-tag" button that calls `autoTagSummary(id)` and renders a `TagSuggestions` panel inline. Apply merges suggested tags; dismiss closes the panel.

---

## File Changes Summary

| Action  | File                                                            |
| ------- | --------------------------------------------------------------- |
| Modify  | `packages/shared/package.json`                                  |
| Modify  | `packages/shared/tsconfig.json` (if exists) or create           |
| Move →  | `packages/shared/src/components/TagSuggestions.tsx`             |
| Move →  | `packages/shared/src/components/SelectionActionBar.tsx`         |
| Modify  | `packages/shared/src/index.ts` (export new components)          |
| Modify  | `apps/extension/entrypoints/summaries/App.tsx` (update imports) |
| Delete  | `apps/extension/components/TagSuggestions.tsx`                  |
| Delete  | `apps/extension/components/SelectionActionBar.tsx`              |
| Modify  | `apps/web/src/lib/api.ts` (add 4 functions)                     |
| Rewrite | `apps/web/src/pages/Dashboard.tsx`                              |
| Modify  | `apps/web/src/pages/SummaryPage.tsx`                            |

---

## Out of scope

- Extension sidepanel: no changes
- Extension summaries page: only import paths updated
- Mobile app: no changes
- New API routes: all required endpoints already exist
