# Summaries Page Design Pass

## Goal

Make the summaries page more usable — scannable, searchable, polished. Focus on information density, findability, and overall UI quality.

## Changes

### 1. Compact Cards

Shrink cards for better scanning. Drop TLDR preview (it's in detail view).

- Thumbnail: `w-44 h-24` → `w-28 h-16`
- Remove TLDR preview text from cards
- Tighten padding: `p-4` → `p-3`
- Add relative date top-right: "2h ago", "Yesterday", "Mar 1"
- Add duration next to channel: "Channel Name · 12min"
- Keep: title (1 line), channel, tags, status badge
- Delete button: trash icon on hover (right edge), inline "Delete?" confirmation

Card height: ~80px (down from ~120px).

### 2. Toolbar Row

Single row below header with search, tag filter, and sort.

```
[🔍 Search summaries...    ] [Tags ▾] [Newest ▾]
```

- **Search**: `<input>` with instant client-side filter by title and channel. No API call — filter the already-loaded summaries array. `useState` + `.filter()`.
- **Tag filter**: Existing `<select>` restyled to match toolbar aesthetic. Stays server-side (passes `?tag=` to API) since it affects total count.
- **Sort**: `<select>` with "Newest" / "Oldest". Client-side `.sort()` on `createdAt`.
- All three in a flex row with consistent height/border styling.

### 3. Relative Dates

Lightweight helper function (no library):

- < 1 min: "Just now"
- < 1 hour: "Xm ago"
- < 24 hours: "Xh ago"
- Yesterday: "Yesterday"
- < 7 days: "Mon", "Tue", etc.
- Same year: "Mar 1"
- Different year: "Mar 1, 2025"

### 4. Delete from List

- Trash icon appears on card hover (positioned absolute, right side)
- Click → icon replaced by "Delete?" text button
- Confirm → optimistic removal from list, API call to `DELETE /summaries/:id`
- Fail → re-insert card, show error toast (or just restore silently)

### 5. Empty States

- **No summaries at all**: Keep existing "No summaries yet" + instruction text
- **No results for filter/search**: "No summaries match your search" with "Clear filters" button
- **Filtered to empty tag**: "No summaries tagged [tag]" with "Show all" button

### 6. Updated Skeletons

Match the new compact card size: smaller thumbnail placeholder, 2 text lines instead of 3.

## Files to Modify

| File                                           | Changes                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/extension/entrypoints/summaries/App.tsx` | Toolbar (search, sort), compact cards, delete, empty states, relative dates |
| `apps/extension/components/Skeleton.tsx`       | Update `SummaryCardSkeleton` to compact size                                |

## Out of Scope

- Pagination / infinite scroll (20 items is enough for now)
- Server-side search (client-side filter is fine for ≤100 items)
- Two-column layout
- Card view toggle (grid/list)
