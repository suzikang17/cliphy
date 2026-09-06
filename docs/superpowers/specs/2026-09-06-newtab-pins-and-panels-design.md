---
type: spec
date: 2026-09-06
title: New Tab — Pins & Panels
---

# New Tab — Pins & Panels — Design Spec

**Date:** 2026-09-06
**Status:** Approved, pre-implementation
**Scope:** First subproject after the "universal clipping platform" pivot (#1–#4)

## Context

The pivot is complete: Cliphy captures any URL, tweet, image or podcast
(#1–#2), enriches every clip with a summary, tags, category and a Voyage
embedding, and exposes semantic search over them (#3), rendered in a two-column
masonry inbox on mobile (#4).

What's missing is a **front door**. Clips are only visible when you deliberately
open the app, which is the reason saved things die — nobody revisits a library
they have to remember to visit. Meanwhile the user wants Cliphy to be the
central hub for all their clipping, and the surface they open dozens of times a
day is the browser's new tab page.

This subproject makes the new tab that front door. It adds **no new ingestion
path and no new AI capability** — it is a display surface over what Cliphy
already knows, plus a small table recording what is on the page and in what
order.

Two intents share the `clips` table and must not be collapsed into one:

- **Triage state** — inbox → archived. A lifecycle; things leave.
- **Pinned** — always handy. No lifecycle; things stay.

A clip can be both (an article you want on your new tab _and_ still intend to
read), so they are independent axes, not one status field.

## Goals

- Replace the browser new tab with a Cliphy surface: a dense **tile strip** of
  pinned things above a **feed of what you saved**.
- **Promote to new tab** as a first-class action from anywhere a clip appears.
- Pin three things: a **clip**, a **view** (a saved filter, including a semantic
  query), and — reserved, not built — a **connector**.
- Add sites as **bookmarks** with no AI summary and no extraction, while leaving
  the door open to enriching them later on demand.
- Keep every pinned bookmark **findable by semantic search**.
- Give clips a real **archive** action, so "inbox" means something.
- Port the mobile card + masonry design to DOM, landing in `apps/web` as well as
  the extension.

## Non-Goals (this phase)

- **Connectors of any kind** — no `Connector` interface, no `user_connectors`
  table, no OAuth, no GitHub, no Gmail. See _Deferred_ for why, and for the
  research that should not be re-derived.
- Pin expiry / auto-demote after N days.
- Pins on mobile (mobile keeps its inbox; pins are a browser-surface feature
  first).
- Any new AI on the page — no summarizing the feed, no generated layouts.
- Native virtualization for the DOM masonry (personal-scale libraries are fine).

## Architecture

```
chrome new tab
   │
   ▼
entrypoints/newtab  (WXT, chrome_url_overrides.newtab)
   │
   ├─ paint from browser.storage.local snapshot   ← instant, no network
   │
   └─ revalidate in background
        │
        ├─ GET /api/pins            → pinned_items rows
        ├─ GET /api/clips?…         → inbox panel query
        └─ GET /api/clips?view=…    → one request per view panel
        │
        ▼
   swap in fresh data, rewrite snapshot

page layout
   ┌───────────────────────────────────────────┐
   │ capture bar   paste URL · clip this tab   │
   ├───────────────────────────────────────────┤
   │ tile strip    pinned_items.layout='tile'  │
   ├───────────────────────────────────────────┤
   │ panels        pinned_items.layout='panel' │
   │   · inbox panel (default, undeletable)    │
   │   · view panels (saved filters)           │
   └───────────────────────────────────────────┘
```

### Content store vs. placement store

The central modelling decision. `clips` holds **content**; `pinned_items` holds
**placement**. A bookmark is always a real clip — searchable, taggable, and
enrichable later. `pinned_items` stores no content, only what appears on the new
tab and in what order.

This matters because a view and (later) a connector are not clips, so pinning
cannot be a flag on `clips` — but ordering across a mixed grid must live in a
single table or interleaving is unmanageable.

Consequence: there is no separate "bare URL bookmark" object. A bookmarked site
is a clip with `enrichment_tier='metadata'`.

## Data Model

### Migration `027_pins_and_panels.sql`

```sql
-- Triage + enrichment facts on clips.
alter table public.clips
  add column if not exists enrichment_tier text not null default 'full'
    check (enrichment_tier in ('metadata','full')),
  add column if not exists archived_at timestamptz;

create index if not exists clips_archived_at_idx
  on public.clips (archived_at) where archived_at is null;

-- Placement: what is on the new tab, and in what order.
create table public.pinned_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('clip','view')),
  layout     text not null default 'tile' check (layout in ('tile','panel')),
  position   int  not null,
  label      text,
  icon_url   text,
  clip_id    uuid references public.clips(id) on delete cascade,
  view_query jsonb,
  pinned_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pinned_items_target check (
    (kind = 'clip' and clip_id   is not null and view_query is null) or
    (kind = 'view' and view_query is not null and clip_id   is null)
  )
);

create index pinned_items_user_position_idx
  on public.pinned_items (user_id, position);
create unique index pinned_items_user_clip_idx
  on public.pinned_items (user_id, clip_id) where clip_id is not null;
```

RLS follows ADR 0016: select-only policies scoped to `user_id`, all writes
through the service role.

### Why these shapes

**`enrichment_tier` records a fact, not a policy.** It says what was done to the
clip (metadata-only vs. full Claude pass), never what it means. The deliberately
undecided question — _should pinned bookmarks appear in the inbox feed?_ —
therefore lives in one clause of the inbox query, not in stored state:

```sql
where deleted_at is null
  and archived_at is null
  and enrichment_tier = 'full'   -- ← remove this line to change the answer
```

Changing your mind is a one-line edit rather than a migration plus a backfill.

**`pinned_items_target` makes invalid states unrepresentable.** Polymorphic
tables rot without it — a `kind='view'` row that also carries a `clip_id` forces
defensive code into every reader. With the constraint, the frontend can trust
`kind`.

**`position` is a plain int; reordering rewrites the affected rows.** The
industry standard for drag-reorder is fractional indexing (LexoRank, the
`fractional-indexing` package), which exists to avoid rewriting rows in
collaborative or thousand-item lists. At ~20 pins per user, a single statement
rewriting the list is free, and fractional indexing brings rebalancing edge
cases with no offsetting benefit. This is a deliberate deviation from the
standard, recorded so it is not mistaken for an oversight. Revisit if pins ever
become collaborative or number in the hundreds.

**`kind` has no `'connector'` value yet.** Adding one later is a single line in
the check constraint; see _Deferred_.

### `ViewQuery`

`view_query` is a **closed, typed struct** — never raw SQL and never an
open filter DSL. It is user-authored JSON that becomes a database query; an
open-ended shape is an injection surface into your own schema. The server
validates known fields and ignores the rest.

```ts
// packages/shared
export type ViewQuery = {
  semantic?: string; // → match_clips (embedding search, from #3)
  search?: string; // → ILIKE fallback
  tags?: string[];
  sourceType?: SourceType[];
  category?: string;
  author?: string; // e.g. a YouTube channel
  limit?: number; // default 12 in a panel
};
```

`semantic` is what makes view panels worth having: a "design inspiration" view
surfaces clips that were never tagged, because #3 already embeds every clip and
`match_clips` already exists. A view is otherwise just the filter state the
mobile inbox can already produce — saved, named, and placed.

## Shared Package Changes

`apps/mobile/lib/masonry.ts` is pure — `heightEstimate(clip)` and
`splitColumns(items)` take a `Summary` and return numbers and arrays, with no
React Native anywhere. Move it to `packages/shared`:

- `heightEstimate(clip: Summary): number` — unchanged.
- `splitColumns(items, columns = 2): Summary[][]` — **generalized to N
  columns.** Two columns is right for a phone and wrong for a 1440px new tab,
  which wants four or five. Same greedy shortest-column bin-packing.
- Mobile imports the shared version and drops its local copy; its call site
  passes `2` (or relies on the default), so behaviour there is unchanged.

Existing unit tests for the pure functions move with them and gain a case for
`columns > 2`.

## Extension Surface

### `entrypoints/newtab/`

WXT entrypoint registering `chrome_url_overrides.newtab`. React DOM + Tailwind
v4 with the existing neobrutalist theme tokens (ADR 0027) — the same stack as
`apps/web`, which is why the DOM card layer is shared rather than
extension-only. Auth reuses the extension's existing session; no new login
surface.

New manifest additions:

- `permissions`: `favicon` (see below).
- `web_accessible_resources`: `_favicon/*`.
- `host_permissions`: unchanged — metadata extraction happens server-side.

### Favicons

Render favicons through Chrome's own cache:
`chrome-extension://<id>/_favicon/?pageUrl=<url>&size=32`, enabled by the
`favicon` permission. No network request, and it matches the icon in the tab
strip.

Explicitly **not** Google's `s2/favicons` endpoint: it is unofficial and it
would send the user's entire bookmark list to a third party one request at a
time.

### DOM card layer

Port the mobile card design (spec #4: category kicker, source glyph, type scale,
content-height hero images, neobrutalist frame) to DOM components. Built in a
form `apps/web` can consume, closing the gap where the web dashboard now lags
mobile.

Cards render a normalized shape rather than `Summary` directly:

```ts
export type PanelItem = {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  image?: string;
  meta?: string[];
};
```

Today every panel maps from `Summary`. The indirection exists because a future
connector panel's items will not be clips, and because it keeps one renderer for
all panel types. It costs one mapper now.

### Zones

- **Capture bar** — paste a URL, or clip the current tab. Adding here creates a
  metadata-tier clip and a `pinned_items` row in one call.
- **Tile strip** — `layout='tile'`, ordered by `position`, drag to reorder.
  Favicon + `label` (a short name — "Linear", not the 80-character page title).
- **Panels** — `layout='panel'`, each rendering `PanelItem[]` through the shared
  masonry. The **inbox panel** is a default, undeletable `pinned_items` row
  whose query is "not deleted, not archived, full tier" — the same component as
  every other panel, so there is no special-case inbox code.

`layout` is a stored column rather than derived from `kind`, so a view can be
demoted to a tile or promoted to a panel without a migration.

### Reading depth

**Peek inline, full read elsewhere.** A card in a panel expands in place to show
the existing summary/TLDR — enough to decide "done" or "worth it" — so triage
never leaves the page. The full summary, transcript and chat navigate to the
existing detail view.

### Archive

`archived_at` needs a user-facing action or the inbox panel never drains: an
archive control on the card and in the detail view, plus an undo affordance
immediately after. Archiving is not deleting; `deleted_at` is unchanged.

## Metadata-Tier Capture

`POST /api/clips` gains a tier hint; adding from the tile strip requests
`metadata`. That path runs the existing `detectSourceType` → `web` branch but
short-circuits enrichment:

- Fetch the page head; take `<title>`, `og:image`, `og:site_name`, icon link.
- **Skip the Claude pass** — no summary, no tags, no category.
- **Still generate the Voyage embedding.**

The embedding is not optional. Semantic search (#3) is embedding-backed, so a
bookmark saved without one is invisible to search — the exact opposite of a
central hub. Voyage costs a small fraction of a Claude call, so keeping every
bookmark findable is nearly free.

Promotion to full enrichment later is one action: set
`enrichment_tier='full'` and fire the existing `clip/enrich.requested`. No new
pipeline.

## Performance

The new tab has one hard constraint: **it must paint before the user perceives
it.** A network round-trip on open makes the browser feel broken.

Cache-first, revalidate behind:

1. On load, read a snapshot from `browser.storage.local` and render immediately.
2. Fetch pins and panel data in the background.
3. Diff and swap; rewrite the snapshot.
4. Cold start with no snapshot renders the tile strip skeleton plus an empty
   feed — never a spinner over the whole page.

Panel queries are capped by `ViewQuery.limit` (default 12) so a panel never
pulls the whole library.

## Error Handling

- **Offline / API unreachable** — the snapshot still renders. A quiet
  non-blocking indicator marks data as stale; no error page on a new tab.
- **Metadata extraction fails** — save the clip anyway with the URL as title, so
  the tile appears and nothing is silently lost. Retry available.
- **Broken favicon** — fall back to a generated monogram tile from the label's
  first letter; never a broken-image glyph.
- **Deleted clip behind a pin** — `on delete cascade` removes the
  `pinned_items` row; the grid closes the gap on next load.
- **Empty view result** — the panel renders with an empty state and stays
  visible, so the user can tell the difference between "no matches" and "the
  panel vanished."
- **Position collisions** after concurrent reorders — last write wins on
  `(user_id, position)`; the client resequences on next load.

## Testing

- **Unit (Vitest)**
  - `splitColumns` with `columns` of 2, 3 and 5; single item; empty list;
    order preserved within a column.
  - `heightEstimate` per source type (moved with the module).
  - `ViewQuery` validation: unknown keys ignored, `semantic` routed to
    `match_clips`, empty query falls back to the inbox default.
  - Pin reordering produces a dense, gapless `position` sequence.
- **Integration**
  - `pinned_items_target` rejects a `kind='view'` row carrying a `clip_id`, and
    a `kind='clip'` row carrying a `view_query`.
  - Metadata-tier capture writes a clip with an embedding and no summary.
  - The inbox query excludes metadata-tier, archived and deleted clips.
  - Archive then unarchive round-trips.
- **Manual (proof-of-done)**
  - New tab paints from cold cache with the network throttled to offline.
  - Chrome's "Keep it / Restore" prompt and omnibox focus behaviour (see
    _Risks_).
  - Drag-reorder persists across a browser restart.

## Build Sequence

1. Migration `027_pins_and_panels.sql`; shared types (`ViewQuery`, `PanelItem`,
   `enrichmentTier`, `archivedAt`).
2. Move masonry to `packages/shared`, generalize to N columns, repoint mobile,
   port tests.
3. Server: archive/unarchive endpoints; inbox query updated for the new
   filters.
4. Server: `GET/POST/PATCH/DELETE /api/pins`; `ViewQuery` → SQL builder
   (semantic via `match_clips`, else filters).
5. Server: metadata tier on `POST /api/clips` (skip Claude, keep embedding);
   "enrich now" promotion endpoint.
6. DOM card layer + `PanelItem` mappers, consumable by `apps/web`.
7. `entrypoints/newtab`: shell, auth, snapshot cache, capture bar.
8. Tile strip: favicons, labels, drag reorder.
9. Panels: inbox panel, then view panels; peek-inline expansion.
10. Archive UI + undo.
11. Smoke pass, devlog, ADR for the content-store/placement-store split.

## Risks

- **Chrome's new tab override friction.** Chrome prompts "Cliphy changed your
  new tab page — Keep it / Restore" on install, and custom NTPs have a history
  of omnibox-focus quirks (the user types expecting the address bar; the page
  has focus). Verify on day one — it is the failure mode that makes an otherwise
  good new tab feel broken. Keep the override opt-in.
- **Two inbox designs drifting.** Mobile masonry and DOM masonry share only the
  pure layout math. Card visual changes must be applied in both, or they
  diverge. Accepted for now; a shared design-token pass is the mitigation if it
  becomes painful.
- **Perceived performance regression** if the snapshot cache is skipped "just
  for now" during development. It is not optional polish; build it in step 7.

## Deferred

### Connectors

Cut from v1 deliberately: connectors are the only part of the original concept
that adds a genuinely new capability (data from a service that is not clips),
dragging in OAuth, token refresh, compliance and a second data source. Everything
else here is composition of existing parts. Deferring costs one line in the
`kind` check constraint later, and `PanelItem` — required by clip panels
regardless — is already the seam a connector would map into.

Research already done, recorded so it is not repeated:

- **Do not build an "OAuth adapter" first.** Of the candidate sources, GitHub is
  OAuth2, **Readwise is a pasted `Token` key** with `updatedAfter` +
  `nextPageCursor` incremental sync, **Granola is a Bearer `grn_` key** from the
  desktop app (Business/Enterprise plans, ~5 req/s), and **WhatsApp has no
  personal-inbox read API at all** (the Business Cloud API covers messages sent
  to a business number; unofficial web clients violate ToS). Three of four are
  not OAuth. The generalizable seam is `credential → fetch(cursor) → PanelItem[]`
  with auth as a tagged union field, not a base class.
- **Abstract the interface when implementation #1 exists, not before.** An
  interface with zero implementors is all cost and no information.
- **Gmail is the worst first connector, for compliance not technical reasons.**
  `gmail.readonly` is a _restricted_ scope (vs. `youtube.readonly`, which is
  merely _sensitive_), requiring an App Defense Alliance / CASA assessment.
  Google's personal-use exemption is a property of the OAuth client, not the
  feature — Cliphy's client serves public extension users, so it does not apply.
  The obvious workaround fails too: an OAuth client left in "Testing" publishing
  status has its refresh tokens revoked every 7 days. Full write-up in the dev
  wiki: `concepts/oauth-scope-tiers-and-connector-compliance.md`.
- **Summarize prose, list structured data.** A GitHub PR list is worse with an
  LLM summary over it; email would earn one. Not every panel wants AI.

### Other deferred items

- **Pin expiry / auto-demote.** The user described temporary pins (a project
  this month) alongside permanent ones. `pinned_at` is recorded from day one
  because it cannot be reconstructed later; the _policy_ — auto-demote, a stale
  pins nudge, or nothing — waits until there is lived evidence. Adding
  `pin_expires_at` later is a nullable column with no backfill.
- **Pins on mobile.**
- **DOM masonry virtualization.**
