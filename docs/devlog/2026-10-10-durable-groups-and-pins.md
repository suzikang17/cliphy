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
