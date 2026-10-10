---
type: decision
title: "Saved tag groups are bookmark folders: closing a tab never removes it"
date: 2026-10-10
category: Extension
revisit: false
---

> Supersedes the pruning rule in ADR 0052 (pages left a group's autosave when you closed them on purpose).

## Why this choice

The user expected a saved group to act like a bookmark folder. Under ADR 0052, closing a tab with ✕, Close all or Stow removed it from the group's saved copy, so pages disappeared from groups as the user worked. Now every page that has been open in a tag group stays in its saved copy until the user removes it.

## Options considered

- **Prune deliberate closes (ADR 0052):** keeps groups tidy automatically, but pages vanish the moment you close a tab. Rejected by the user.
- **Never prune; explicit removal (chosen):** the group is a folder.
  - Its closed pages show under **Not open** in the card. Clicking one reopens it into the group.
  - ✕ removes a page from the group.
  - Moving a page to another group moves it out (one page, one group).
  - ✕ on a Closed groups row forgets the whole group.

## Tradeoffs

- Groups grow until you prune them by hand. The Not open list shows 5 pages, then "Show all".
- The background tracker no longer touches snapshots at all, so `onPageClosed` was removed. Server sync is only `pushSnapshots`.
