---
type: decision
title: "Tabs view: tags are the contexts; page content via optional runtime permission"
date: 2026-10-09
category: Extension
revisit: false
---

## Why this choice

The Tabs view (side panel, Cmd/Ctrl+Shift+K) must organize open tabs by _content_ — two clients' Notion/Linear pages share hosts and often titles, so only page text tells them apart. Two decisions made that possible without new systems or breaking existing installs:

1. **Tags are the contexts.** Client/project contexts are hierarchical tags (`client:acme`) with optional free-text hints in a new `tag_hints` table, which also registers tags that have no clips yet. Jev picks the tag per tab (hints go into the choice option descriptions); Claude names groups for leftovers, offered as "＋ Save as tag". No second category system.
2. **Page text via optional `scripting` + `<all_urls>`**, requested from an in-panel toggle. Required permissions are unchanged, so Chrome does not disable the auto-updated extension for existing users (same reasoning as `history` in `wxt.config.ts`).

## Options considered

- **Native Chrome tab groups** — rejected by the user; organization lives in Cliphy's view, the tab strip is untouched.
- **Server fetches each URL** — no permission needed, but fails behind logins, i.e. on exactly the client work this is for.
- **Titles/URLs only** — no permission, weak at separating clients (kept as the fallback when the toggle is off).
- **A separate `contexts` table/UI** — duplicates tags; tags already nest and already drive auto-tagging.

## Tradeoffs

- Gain: content-aware grouping that worked on live Jev (2 clients on the same hosts, 4/4 correct, ~300ms); zero install-time permission change; contexts and auto-tagging share one taxonomy.
- Give up: page text (≤ 2,000 chars) leaves the browser when the toggle is on — disclosed in the toggle copy and privacy policy, never persisted or logged server-side; password-form pages are skipped. A per-site "never read" list is backlog.
- The "probably done" question's phrasing mattered more than the threshold: "is the user finished with…" scored search/login pages ~0.2; "is this a transient page…" scored them 0.77–0.95 vs ~0.18 for live work. Threshold 0.7.
