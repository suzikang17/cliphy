---
type: decision
title: "Separate placement store (pinned_items) rather than pin flags on clips"
date: 2026-09-06
category: Architecture
revisit: false
---

## Why this choice

The new tab shows a grid of pinned things: saved clips, and saved _views_ (a
filter, including a semantic query). The obvious first design was to make
pinning a property of a clip — `clips.pinned_at` plus `clips.pin_position`.

That breaks the moment a view can be pinned. A view is not a clip: it has no
content, no URL, no embedding. It cannot be a row in `clips` without inventing
a fake clip, and a future connector panel (GitHub, Readwise) is the same shape.
Meanwhile **ordering across the grid has to live in one table** — if pinned
clips order themselves in `clips.pin_position` while views order themselves
somewhere else, interleaving a mixed grid means merging two orderings on every
read and reconciling them on every drag.

So the model splits on a cleaner seam:

- **`clips` is the content store.** A bookmarked site is still a real clip —
  searchable, taggable, and enrichable later via `POST /summaries/:id/enrich`.
- **`pinned_items` is the placement store.** It holds no content: only what is
  on the new tab, in what order (`position`), and how it renders (`layout`).

A `pinned_items_target` check constraint makes the polymorphism safe —
`kind='clip'` requires `clip_id` and forbids `view_query`, and vice versa — so
readers can trust `kind` instead of defending against half-populated rows. The
database rejects both invalid shapes; this was verified against the live schema
rather than assumed.

Two related choices fall out of the same "store facts, defer policy" idea:

- **`clips.enrichment_tier`** records _what was done_ to a clip (metadata-only
  vs. a full Claude pass), never what it means. Whether bookmarks appear in the
  inbox feed is then one `where` clause, changeable without a migration.
- **`pinned_at`** is recorded from day one because it cannot be reconstructed
  later; pin _expiry_ policy is deferred until there is lived evidence for it.

## Options considered

- **`clips.pinned_at` + `pin_position`** (rejected) — simplest while only clips
  are pinnable; cannot express a pinned view, and splits grid ordering across
  two tables as soon as anything non-clip is pinned.
- **A `pins` table that can also hold standalone URLs** (rejected) — would make
  a bookmark a second kind of saved-URL object, so search, dedup and enrichment
  all have to span two stores.
- **`pinned_items` as pure placement, clips unchanged** (chosen) — one content
  store, one ordering, and non-clip pins are representable.
- **Fractional indexing (LexoRank) for `position`** (rejected for now) — the
  industry standard for drag-reorder, but it exists for collaborative and
  thousand-item lists. At ~20 pins, rewriting the list in one statement is free
  and avoids rebalancing edge cases. Revisit if pins become collaborative.

## Tradeoffs

**Gained:** views and future connectors are pinnable without fake clips; a
single `position` sequence orders a heterogeneous grid; invalid pin shapes are
unrepresentable at the database level; bookmarks stay first-class clips, so
"summarize this properly" later is an existing pipeline rather than a migration.

**Given up:** a second table and a join to render tiles, versus reading two
columns off `clips`. Rendering a clip tile needs the clip loaded, which the new
tab already does for its panels but which a tiles-only view would have to fetch
deliberately. The check constraint also means adding a third pin kind is a
migration, not just a new value — accepted, since that is exactly the moment
worth pausing on.
