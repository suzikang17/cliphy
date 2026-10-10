---
day: 68
date: 2026-10-10
phase: Growth
title: "Day 68 — Durable groups & pins: the Tabs view as a trustworthy tab manager"
---

**Pins, closable/resumable groups, Trail on by default and stale-tab stow — so you can close tabs freely and trust nothing is lost.**

## What got done

- **Trail retention is free-form** — any 1–3650 days or forever (`null`), entered as days / weeks / months / forever in the Tabs view (`7041128`, `ec66437`).
- **Trail on by default** for signed-in users with a one-time notice (Keep / Turn off); an explicit "off" stays off (`ec66437`). ADR 0050 marked superseded.
- **Pins** — `p` in the Tabs view or **⌘⇧P** from any page pins it: a bookmark-tier clip + new-tab pin, tag from `page_tags`, name/note carried, trail row removed so retention can never delete it. Idempotent `POST /api/pins/page` (`9cbcd1c`, `b475f67`). Pinned group lists closed pins; open pins get 📌 in their tag group.
- **Close a whole group, resume later** — ⇧C / ⋯ → Close group snapshots open pages to `closed_groups` (migration 036) and closes the tabs; "Closed groups" section with Resume reopens snapshot + the group's pins, skips open pages, new window above 8 (`c9ec2e0`, `6ace4ef`). Local fallback snapshot when the server can't be reached.
- **Group counts** — tag group headers show `N open · N pinned · N in trail`; ⋯ → "Open N from trail" (`GET /api/trail?tag=`).
- **Stale tabs** — rows untouched 3+ days get a "stale" marker; **Stow stale (N)** / **⇧W** stows them oldest first, never pinned or active tabs (`5ab4f93`).
- Privacy policy Trail paragraph updated (on by default, free-form retention, pins/closed groups kept regardless).

## Decisions

- Pin = bookmark-tier clip + pin (reuses `pinned_items` and the new-tab tile) rather than a separate table.
- Resume reopens pages open at close + pinned; trail pages are offered, never reopened automatically.
- Pinned group shows only closed pins; open pins live in their tag group with 📌 so group actions include them.
- Spec: `docs/superpowers/specs/2026-10-10-durable-groups-and-pins-design.md`; plan + rulings in the plan ledger.

## Issues

- `apps/server/src/routes/__tests__/tabs.test.ts` had been committed **empty** in `9790cd1` (a Python read/write one-liner truncated it); a grep that only matched per-test FAILs hid the file-level failure. Restored from `3819e33` and re-added the page_tags route tests.
- New hook fields (`closedGroups`, `closeGroup`, `resumeGroup`) broke the TabsView tests' hand-written hook mocks — extend mocks whenever the hook grows.

## What to remember

- Chrome allows 4 global commands; 3 are used now (⌘⇧K open Tabs view, ⌘⇧S save, ⌘⇧P pin).
- Page identity everywhere is `normalizeUrl` from `@cliphy/shared` — compare pins/snapshots by it, never by raw URL or `pin.key`.
- Migration 036 applied to prod with `psql -f` (never `supabase db push`).

## Final review + deploy

- Fresh whole-branch review: 0 Critical, 5 Important, all fixed test-first in `2b313fb`:
  - Resume opened **every** pin → now only pins tagged with the group (`clipTags` on `GET /api/pins`, `pinsForGroup`).
  - `p` couldn't unpin (key handler held a first-render `togglePin`) → routed through `latest.current`.
  - Pinning a summarized YouTube video created a duplicate clip (videos have `video_url`, not `source_url`) → one `.or()` lookup by `youtube_video_id` / raw+normalized `source_url` / `video_url`, `.limit(1)`; verified read-only against prod.
  - Pinned pages stayed in the Trail (rows hold raw URLs) → delete matches raw + normalized.
  - Closed-groups local cache drifted → load pushes local-only snapshots, drops older ones, retries unconfirmed resume deletes (`tabs:resumePending`).
- Deferred minors: resume per-tab error handling; close-under-search snapshots only matches; >100-page snapshots 400; reused clip skips tag/note; `:key` length cap + double-decode; concurrent first pins 500; retention picker saves per keystroke; closed groups not keyboard/search reachable; ⌘⇧P pins not live in panel; "+N from trail" approximations; unpin of pending pin errors.
- Pushed `0a91659..c18c820`; prod deploy Ready, `/health` 200, new routes 401 unauthenticated, privacy text live. Extension 1.2.0 zipped (Web Store upload pending).

## Later — tabs lost on restart

- The user lost tabs on a browser restart. The Trail had them: 7 different pages, all closed within one second (10:31:42–43). That points to the browser quitting with them open and not restoring them, not to Cliphy (the dupe interceptor only closes a copy of an already-open page).
- Hardened the duplicate interceptor anyway (`d4fb9ec`):
  - It ignores tabs created in the first 60s of a browser session, so tabs the browser restores never count as new duplicates. The session start is a `storage.session` key, which the browser wipes on restart.
  - Duplicate detection uses `dedupeKey`: it keeps the `#fragment` when it's an app route (`#/x`, `#!x`, `#inbox/<id>`), so Gmail threads aren't treated as one page. A plain `#anchor` still counts as the same page.
- New: **Reopen into…** picker on Recently closed rows (`d810880`). `placeUrl` records the group choice for the address, then the tab reopens and lands in that group.
- **Groups autosave** (ADR 0052): every tag group keeps a snapshot while its tabs are open. Pages leave it only when you close them on purpose (`isWindowClosing: false`); a quit or window close keeps them, so after a bad restart the group shows under Closed groups → Resume. ⇧C marks the group closed; ✕ forgets a closed group. This replaces the local fallback cache and the pending-delete retry from the review fix.
- One-click **↳ <tag>** on Recently closed rows reopens into the group its Jev/keyword tag already points to.
- **Stuck on "Organizing…" (fixed `7570084`)**: prod logs showed no `POST /api/tabs/organize` at all; the panel hung before sending it. Root cause: `scripting.executeScript` (reading page text) can wait forever on a tab that's asleep or still loading (right after a restart; Dia's unloaded sidebar tabs). `inFlight` stayed true, so organize never ran again. Each page read now gives up after 2s (`EXTRACT_TIMEOUT_MS`) and sends title + address only.
- **Later UI work**:
  - Notes per tag group (`c0d9afa`, migration 037 `tag_notes` applied to prod with `psql -f`).
  - Drag a tab onto another group to move it (`91020d4`).
  - Group stats moved to the card bottom and ✕ to the far right (`e8a4979`).
  - Compact "Into" dropdown on Recently closed rows (`5050c84`). Checked with a headless-Chrome screenshot using the built CSS.
  - **Tile view** (`08d6996`): List / Tiles toggle, **v** to switch, remembered in `tabs:view`. Tiles show the page's `og:image`, read only while tiles are on, with a 1.5s timeout per tab. The image address is kept locally (`tabs:previews`, 500 max) and never sent anywhere. Pages without one show the site icon.
- **Tiles**: masonry with 4 columns (`f5352b8`). Banner/logo-shaped previews (aspect ratio >2.4 or <0.5) sit whole in a fixed box instead of a thin strip (`9a69bfa`).
- **Saved summaries in groups** (`HEAD`): each tag group lists your saved Cliphy clips with that tag (▶ video / 📄 article, title, first sentence of the summary; click opens it on cliphy.app). It uses the existing `GET /api/summaries?tag=&limit=12`, cached in `tabs:savedByTag`. `openWebApp` moved to `lib/webApp.ts`.
- **Visible autosave** (`HEAD`): bottom-right of each tag group card shows the save state (✓ Saved / Saving… / Saved on this device) and saves now on click (`saveGroupNow`). Each tab in the group's saved copy gets a ✓ ("comes back after a restart"). The hook exposes `saveStatus` and `savedPages`.
