---
type: decision
title: "Trail: closed tabs saved server-side, opt-in, kept forever by default (configurable)"
date: 2026-10-10
category: Extension
revisit: true
---

## Why this choice

"Open tabs freely and never lose them" needs closed tabs to stay findable. Chrome's own history is per-device, unorganized and not searchable by Cliphy's tags. The Trail saves each closed page (address, title, your name/note) to a separate `trail_items` table, auto-tagged with the same cheap path as ⌘⇧S (keywords + Jev, no Claude, no page reading), one row per URL (re-closing bumps `closed_at`/`close_count`). It is kept apart from clips so the curated library doesn't fill with every tab; one click promotes an entry to a clip.

## Options considered

- **Save closed tabs as clips** (user's first instinct) — makes them searchable everywhere, but floods the library; rejected in favour of a separate trail with promote.
- **Local-only (extension storage)** — private, but lost on reinstall/other devices and no server search or tagging.
- **On by default** — the "never think about it" experience, but it sends every closed page to the server; chose opt-in with explicit toggle copy and a privacy-policy section.
- **30-day retention by default** — the recommended default; the user chose **forever by default, configurable** (7/30/90/365 days via a daily purge cron).

## Tradeoffs

- Gain: closed tabs searchable by title, URL, tag, your name and note; reopen or promote in one click; closing stays instant (batched, debounced capture).
- Give up: browsing history stored server-side (opt-in, disclosed, never page text); the table grows without bound for users who keep the default.
- Skip rules (search results, sign-in pages, tabs open <10s, pages still open elsewhere, pages already clips) keep noise down; revisit once real trails exist.
