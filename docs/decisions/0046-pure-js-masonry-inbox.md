---
title: "Pure-JS two-column masonry inbox (over a native masonry library)"
date: 2026-09-06
category: Tech
revisit: false
---

## Why this choice

Subproject #4 makes the inbox a two-column masonry "wall" so images, screenshots,
and tweets get vertical weight while link-only clips stay compact — chosen for iOS
after comparing masonry / list / grouped mockups. The masonry is implemented in
**pure JS**: `heightEstimate(clip)` gives each card a rough relative height by type,
and `splitColumns` greedily assigns each clip to the currently-shorter column
(preserving feed order within a column). `MasonryFeed` renders two flex columns of
the existing `ClipCard`s inside the inbox's `ScrollView`.

The decisive factor was **OTA shippability**. A native masonry library
(FlashList's masonry) is a native module — adopting it would force a new TestFlight
build for the redesign. The pure-JS approach is JS-only, so it ships as an `eas
update` OTA to the installed app with no rebuild, matching how the rest of the
pivot ships.

## Options considered

- **Pure-JS bin-packed two columns (chosen)** — OTA-shippable, no native module,
  reuses existing cards; loses list virtualization.
- **FlashList masonry** — virtualized and purpose-built, but a native dependency
  (new build required) and heavier integration.
- **`react-native-masonry-list`** — also non-trivial, less maintained, still not
  worth a rebuild for a personal-scale library.

## Tradeoffs

- **Gain:** the intended visual "wall", OTA-shippable, minimal new code, cards
  unchanged.
- **Give up:** no scroll virtualization — the whole feed renders at once. Fine at
  personal-library scale (tens–hundreds of clips). If a library grows into the
  thousands and scrolling degrades, swap `MasonryFeed`'s two-column render for
  FlashList masonry (a contained change behind the same component) — deferred until
  the need is real.
- Column balance uses a heuristic height estimate, not measured heights, so columns
  can be slightly uneven; acceptable and cheap to tune in `heightEstimate`.
