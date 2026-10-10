---
type: decision
title: "Tag groups autosave; only tabs you close on purpose leave them"
date: 2026-10-10
category: Extension
revisit: true
---

> **Superseded in part (2026-10-10) by ADR 0053:** closing a tab no longer removes it from its group; groups are bookmark folders.

## Why this choice

A restart lost a group's tabs (the browser didn't restore them) and the only record was the Trail, one page at a time. Groups should be durable without a "save" step. Every tag group now keeps a snapshot (`tabs:groupSnapshots` locally plus the `closed_groups` table on the server, debounced) while its tabs are open. A page leaves the snapshot only when you close its tab on purpose: `tabs.onRemoved` with `isWindowClosing: false`, and the page isn't open elsewhere. Tabs that vanish with a window or a browser quit stay. A snapshot with none of its pages open is shown under Closed groups with Resume. ⇧C marks the group closed so closing its tabs keeps every page; ⇧X / Stow / x prune as usual.

## Options considered

- **Manual "save group" button**: extra step, and you forget it right before the crash.
- **Snapshot = exactly what's open now**: a quit or crash would empty it, which is the case we need to cover.
- **Union forever (never prune)**: groups fill with pages you were done with; Resume reopens junk.
- **Autosave + prune deliberate closes (chosen)**: the browser tells us when a close was part of a window closing.

## Tradeoffs

- Closing a window on purpose keeps its tabs in their groups (shows as a closed group). That's arguably right, and ✕ forgets a group.
- Dia hides unloaded sidebar tabs from `tabs.query`, so a group whose tabs are all unloaded there can look closed. Resume skips pages it can see open, not hidden ones.
- Snapshots are capped at 100 pages (server limit), newest first.
- Pages are address + title only, same as the Trail and `page_tags`.
