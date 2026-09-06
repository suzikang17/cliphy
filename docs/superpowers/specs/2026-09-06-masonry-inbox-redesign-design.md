# Masonry Inbox Redesign — Design Spec

**Date:** 2026-09-06
**Status:** Approved, pre-implementation
**Scope:** Subproject #4 (final) of the "universal clipping platform" pivot

## Context

Subprojects #1–#3 shipped universal capture, image OCR, and enrichment + semantic
search. The inbox is still a plain single-column `FlatList` of per-type cards. This
subproject delivers the "beautiful display experience": a **two-column masonry
feed** where visual clips (images, screenshots, tweets, hero-image web pages) get
vertical weight and link-only clips stay compact — the Pinterest-style "wall" that
suits design curation, chosen by the user for iOS.

The masonry is implemented in **pure JS** (bin-packed two columns), not a native
library, so it ships as an **OTA update** (no new TestFlight build) and keeps the
neobrutalist cards. Virtualization (FlashList masonry) is a deferred optimization
for very large libraries.

## Goals

- A two-column masonry inbox: each clip flows into the currently-shorter column
  using a per-type height estimate, so columns stay balanced.
- Per-type card polish: consistent category kicker, source glyph, tighter type
  scale, hero images where present, variable (content-driven) height.
- Search results and category-filtered views render through the **same** masonry.
- Pull-to-refresh, the search field, category chips, capture "+", clipboard banner,
  and Realtime updates all keep working.

## Non-Goals (this phase)

- Native virtualization (FlashList) — deferred; pure-JS masonry is fine at personal
  scale and OTA-shippable.
- Detail-screen redesign — already generalized in #1–#2; left as-is.
- New animations beyond the existing "processing" pulse.
- Web app redesign (mobile only).

## Architecture

```
app/(tabs)/index.tsx
  header (logo · + capture) · search field · category chips
  → ScrollView + RefreshControl
      → <MasonryFeed items={listData} />        // listData = searchResults ?? visibleItems
           split items into [colA, colB] by running height estimate
           render two <View> columns side by side, each a stack of <ClipCard>
  → CaptureSheet, clipboard banner, UsageBar   (unchanged)
```

- **`components/MasonryFeed.tsx`** (new):
  - `export function MasonryFeed({ items }: { items: Summary[] }): JSX.Element`
  - Uses `splitColumns(items)` to bin-pack into two columns (assign each item to the
    column with the smaller running estimated height).
  - Renders a `flex-row` with two `flex-1` columns, `gap` between and within.
- **`lib/masonry.ts`** (new):
  - `export function heightEstimate(clip: Summary): number` — per-type heuristic
    (image/screenshot & tweet-with-media tallest; hero-image web medium; link/podcast
    shortest). Pure, unit-tested.
  - `export function splitColumns(items: Summary[]): [Summary[], Summary[]]` — greedy
    shortest-column bin-packing preserving feed order within each column. Pure,
    unit-tested.
- **Cards** (`WebCard`, `TweetCard`, `ImageCard`, `QueueCard`): remove fixed heights
  that fight masonry (e.g. `h-40`, `h-32`, `w-28`) so cards size to content; keep the
  neobrutalist frame. `QueueCard` (YouTube) keeps its thumbnail but becomes full-width
  within its column. Each card already reads from `Summary` — no data changes.

## Card polish

- Consistent **category kicker** (small uppercase chip in the AI category color) at
  the top of each card when `clip.category` is set — reuses the category hues.
- **Source glyph** prefix on the meta line: `▶` youtube, `🔗` web, `🐦` tweet,
  `🎧` podcast, `🖼` image.
- Type scale: title 15px bold `-0.01em`, meta 12px muted, excerpt 13px muted.
- Hero images fill the card width at natural aspect (`aspectRatio` from metadata when
  known, else a sensible default) rather than a fixed pixel height.

## Data flow

No server or type changes. `MasonryFeed` consumes the existing `Summary[]` already
loaded by the inbox (`getQueue`, `searchClips`, category filter). Realtime updates
mutate `items` as today; masonry re-splits on each render (cheap for a personal
library).

## Error / edge handling

- **Empty feed / empty search** → the existing `EmptyState` renders in place of the
  columns (masonry only renders when `items.length > 0`).
- **Odd item counts** → bin-packing handles any count; a single item goes to column A.
- **Unknown/legacy clips** (no category, no hero) → render as a compact link-style
  card; `heightEstimate` returns the short baseline.
- **Very tall single card** (long tweet) → capped by `numberOfLines` on text so one
  card can't dominate a column.

## Testing

- **Unit (Vitest):** `heightEstimate` returns taller values for image/tweet-with-media
  than for link/podcast; `splitColumns` distributes into two columns, balances by
  estimate (e.g. one tall + several short lands tall alone opposite the shorts), and
  preserves order within a column. Deterministic — no RN rendering needed.
- **Mobile:** typecheck; manual check that pull-to-refresh, search, chips, and capture
  still work (masonry is a render swap, not a data change).

## Build sequence

1. `lib/masonry.ts` — `heightEstimate` + `splitColumns` (pure, unit-tested).
2. `components/MasonryFeed.tsx` — two-column render using `splitColumns`.
3. Card polish — remove fixed heights, add kicker + source glyph to `WebCard`,
   `TweetCard`, `ImageCard`, `QueueCard`.
4. `app/(tabs)/index.tsx` — swap the `FlatList` for `ScrollView` + `MasonryFeed`
   (keep RefreshControl, search, chips, empty state, capture, banner).
5. Devlog + ADR (pure-JS masonry over native, OTA rationale). Ship the pivot.
