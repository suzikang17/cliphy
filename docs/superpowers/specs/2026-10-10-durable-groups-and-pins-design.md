---
type: spec
date: 2026-10-10
title: Durable groups & pins — the Tabs view as a trustworthy tab manager
---

# Durable groups & pins — Design Spec

**Date:** 2026-10-10
**Status:** Draft for review
**Scope:** Browsing-memory piece 2b. Builds on the Tabs view (spec 2026-10-09), Trail (ADR 0050), persisted page groups (`page_tags`, commit `9790cd1`) and the new-tab pins board (spec 2026-09-06).

## Context

The Tabs view can sort tabs well, but a group is still only a live view of what happens to be open. The user's ask: _"make pins persistent and more stable and easier to find so they can trust we're not losing any tabs — act more like a smart bookmark/tab manager."_ Snapshots of pages were considered and rejected: Chrome can only capture the visible tab, screenshots pull in sensitive content (a different privacy/PCI scope), and the signals we already hold (text on demand, dwell, reopen counts, worked-together clusters) cover the value.

This spec adds three things, all on data we already store (address + group + title; never page text):

1. **Pins as the trust anchor** — pin a tab in one keystroke; pinned pages persist, show whether they're open, reopen in one click, never get pruned.
2. **Groups as durable workspaces** — a tag group is open tabs + pinned pages + trail pages for that tag. You can **close a whole group** and **resume** it later.
3. **Trail on by default** for the safety net to exist from day one (supersedes the opt-in default in ADR 0050).

Plus one small helper: **stale-tab stow**.

## Decisions (from brainstorm)

| Question                        | Decision                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What pinning creates            | A **bookmark-tier clip** (`enrichment_tier: metadata`, no Claude pass, embedded) **+ a pin** on the new-tab board — reuses `pinned_items` and the existing tile. Pinned pages therefore appear in the library; pinning is deliberate, so that's intended.                        |
| What Resume reopens             | **Pages open when the group was closed + its pinned pages.** Trail pages of the group are shown as "+N from trail · open all", never reopened automatically. ("Everything ever" was considered to force clean groups; it risks reopening dozens of tabs, the opposite of trust.) |
| Trail default                   | **On by default** for signed-in users, with a one-time first-run notice in the Tabs view (what's stored, one-click off). Existing users who explicitly turned it off stay off.                                                                                                   |
| Trail retention                 | **Any number of days, weeks or months, or forever** (stored as days, 1–3650, or null). Replaces the fixed 7/30/90/365 list.                                                                                                                                                      |
| What retention can never delete | **Pinned pages.** Pinning moves a page out of the Trail into a clip (like "save to clips"), so the Trail's retention has nothing of yours to lose; closed-group snapshots live in their own table and are never expired.                                                         |
| Snapshots                       | Not now (see Context).                                                                                                                                                                                                                                                           |

## 1. Pins

**Pin a tab:** row `⋯ → Pin` or shortcut **`p`** (pins the selected row); a pinned row shows 📌. From any page, the global command **⌘⇧P / Ctrl+Shift+P** ("Pin this page") pins the current tab without opening the panel and shows the ⌘⇧S-style on-page toast ("Pinned · <tags>"); it takes the third of Chrome's four global command slots (after ⌘⇧K and ⌘⇧S). ⌘P was rejected: Chrome owns it (Print). Pinning calls `POST /api/pins/page { url, title }`:

- find-or-create a metadata-tier clip for the page (the existing bookmark tier; duplicate URL → reuse the clip); the page's tag from `page_tags` (your choice first, then the AI's) is applied to the clip;
- create a `pinned_items` row (`kind: clip`, `layout: tile`) unless one exists for that clip (the unique index already guarantees one pin per clip);
- carry the page's name/note from the Tabs view into the clip (name → title, note → clip notes), as stow and ⌘⇧S do;
- **remove the page's Trail entry if it has one** (promote semantics) — a pinned page lives in clips, never in the Trail, so no retention setting can ever delete it;
- return `{ pin, clip, created: boolean }`. Idempotent: pinning twice is a no-op.

**Unpin:** `p` again / `⋯ → Unpin` → `DELETE /api/pins/:id` (existing). The clip stays in the library.

**Pinned group:** always first in the Tabs view (above Duplicates), listing every page pin:

- **open** pins: "open · tab title" — click/Enter switches to the tab (same as any row);
- **closed** pins: click/Enter opens the page in a new tab;
- `x` on a closed pin = unpin (confirm-free, Undo banner); `x` on an open pin closes the tab (it stays pinned).
- Search matches pinned pages (title, URL, label).
- Pinned pages are never in the Trail (see above) and are excluded from stale-tab suggestions. Unpinning keeps the clip in your library — nothing is lost either way.

Open pinned tabs **also** appear in their tag group with 📌, so group actions (close/stow all) include them. The Pinned group is the "parking lot" view; the tag group is the working view.

New-tab board: nothing new — page pins are ordinary clip tiles.

## 2. Durable groups

A tag group = `page_tags` rows with that tag (AI or override) ∪ pins with that tag ∪ trail items with that tag. The Tabs view shows, per tag group header: **`6 open · 2 pinned · 14 in trail`**.

**Close group** (`⋯ → Close group`, shortcut **`⇧C`**):

1. `PUT /api/tabs/groups/:key/close { pages: [{ url, title }] }` snapshots the currently open pages of the group into `closed_groups` (one row per user+group; a later close replaces it);
2. closes the tabs (the Trail captures them as usual, so nothing is lost even if the snapshot call fails — the snapshot is best-effort, the Trail is the guarantee).

**Closed groups section:** between open groups and Recently closed: `Lotus Bech · 6 tabs · closed 2h ago · [Resume]`. Collapsed by default when empty.

**Resume** (`Enter` on the row): `POST /api/tabs/groups/:key/resume` returns the snapshot pages and removes the row; the extension opens those pages **plus the group's pinned pages** that aren't already open, skipping any URL already open (dedupe), in a new window if more than 8 pages. The group reappears as an open group immediately (its pages are already in `page_tags`, so no AI runs).

**"+N from trail · open all"** in the group's `⋯` menu: lists the group's trail pages (`GET /api/trail?tag=<tag>`) with per-row reopen and an "open all" action (confirmation when N > 10).

**Stale-tab stow:** rows untouched for **3+ days** (from `lastAccessed`) get a faint "stale" marker; the Tabs view header gains **Stow stale (N)** which stows them (trail capture + close; pinned tabs excluded). Threshold is a constant for now (`STALE_AFTER_MS = 3 days`).

## 3. Trail default and retention

- **Retention** becomes a number + unit: _days / weeks / months / forever_. The extension converts to days (`weeks × 7`, `months × 30`); the server accepts `retentionDays` as an integer 1–3650 or `null` (forever), replacing `RETENTION_CHOICES`. The daily purge keeps working unchanged. The setting UI shows the effective value ("Keep closed tabs for 3 weeks").
- **What retention can't touch:** pinned pages (they're clips, not trail entries), closed-group snapshots (`closed_groups`), and anything you promoted to a clip. The Trail is the net for everything you _didn't_ decide to keep.
- `isTrailEnabled()` returns **true unless `trail:enabled === false`**. Existing users who never touched the toggle flip to on at the next extension start.
- **First-run notice** (once per install, `storage.local` `trail:noticeSeen`): a banner in the Tabs view — "Cliphy now remembers tabs you close (address and title, never page content) so nothing is lost. [Keep] [Turn off]". Turn off sets `trail:enabled = false`.
- Privacy policy: the Trail paragraph changes from "If you turn on…" to "On by default… you can turn it off in the Tabs view"; ADR 0050 gets a superseded note pointing here.

## Data model

Migration `036_closed_groups.sql`:

```sql
create table if not exists closed_groups (
  user_id   uuid not null references users(id) on delete cascade,
  group_key text not null,                 -- Tabs-view group key, e.g. 'tag:freelance:lotus-bech'
  label     text not null,
  pages     jsonb not null default '[]',   -- [{ url, title }], max 100
  closed_at timestamptz not null default now(),
  primary key (user_id, group_key)
);
alter table closed_groups enable row level security;
```

No change to `pinned_items`, `clips`, `page_tags` or `trail_items`.

## API

| Endpoint                            | Body / params                                          | Returns                                                            |
| ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `POST /api/pins/page`               | `{ url, title? }`                                      | `{ pin, clip, created }` (201 created / 200 existing)              |
| `GET /api/tabs/groups/closed`       | —                                                      | `{ groups: [{ key, label, pages, closedAt }] }`                    |
| `PUT /api/tabs/groups/:key/close`   | `{ label, pages: [{ url, title }] }` (1–100)           | `{ closedAt }`                                                     |
| `POST /api/tabs/groups/:key/resume` | —                                                      | `{ pages: [{ url, title }] }` and the row is deleted (404 if none) |
| `GET /api/trail?tag=<tag>`          | existing list + exact tag filter                       | `TrailListResponse`                                                |
| `PUT /api/trail/settings`           | `{ retentionDays: 1–3650 \| null }` (was a fixed list) | `TrailSettings`                                                    |

All authed; `/pins/page` rate-limited with the existing quick-save bucket (120/hour).

## Extension

- `lib/tabs/pins.ts`: `usePagePins()` — loads `GET /api/pins` (cached snapshot like the new-tab board), maps clip pins to normalized URLs, exposes `isPinned(url)`, `pin(tab)`, `unpin(url)` with optimistic updates and Undo.
- `components/tabs/PinnedGroup.tsx`, `ClosedGroups.tsx`; `TabGroupSection` gains the counts line, `Close group`, `+N from trail`; `TabRow` gains 📌 and `p`.
- `lib/tabs/stale.ts`: `isStale(tab, now)`, `staleTabs(tabs, pinnedUrls)`.
- Shortcuts: `p` pin/unpin (panel), `⇧C` close group, `⇧W` stow stale; manifest command `pin-page` (⌘⇧P) handled in the background like `save-page`; cheat sheet updated.
- Search (`filterGroups`) also filters the Pinned group and closed groups.

## Errors

| Situation                               | Behavior                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pin request fails                       | Row shows "Couldn't pin — retry"; nothing closed.                                                                                                |
| Close-group snapshot fails              | Tabs still close (Trail captures them); a "Resume" row is synthesized locally from the pages we tried to snapshot and retried on the next flush. |
| Resume with some pages failing to open  | Opens the rest; reports "Opened 5 of 6".                                                                                                         |
| Resume while signed out                 | Resume uses the locally cached snapshot if present; otherwise prompts to sign in.                                                                |
| Trail default flip for an existing user | Only if the key was never set; an explicit false stays false.                                                                                    |

## Privacy

Nothing new is collected: pins and closed-group snapshots hold address + title, which `page_tags` and the Trail already store. The policy text changes only for the Trail default. Page text is still never stored.

## Testing

- **Server unit:** `/pins/page` find-or-create + idempotency + tag applied + trail row removed + name/note carried; retention accepts 1–3650/null and rejects 0, 5000, strings; closed-group close/resume/404; trail `tag` filter; metadata clip reuse on duplicate URL.
- **Extension unit:** retention unit picker → days (3 weeks = 21, 6 months = 180, forever = null); pin map by normalized URL, optimistic pin/unpin + undo, Pinned group open/closed rows, `p`/`⇧C`/`⇧W`, close-group snapshot payload, resume dedupe + new-window rule (>8), stale detection, first-run notice once, trail default semantics (unset → on, false → off).
- **E2E proof:** load unpacked; pin a tab (tile appears on the new tab); close the Lotus Bech group; reload the browser; Resume reopens the pages + pinned; stale marker appears on an old tab.

## Out of scope

Page screenshots/snapshots; cross-browser sync of the activity log; learning "you'll want this again" (recurrence/time-of-day) — next piece; auto-closing stale tabs without confirmation.
