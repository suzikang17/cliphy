---
type: decision
title: "Group leftover tabs using how they were worked on together, and show why — not strict keyword verification"
date: 2026-10-10
category: AI
revisit: true
---

## Why this choice

Claude proposed grouping a client's Google Drive folder with a Stripe dashboard. It looked wrong (no shared words) but was right — both were the user's freelance job. The real problems were (1) the old prompt forced at least one group ("Make 1-5 groups"), and (2) users couldn't see _why_ tabs were grouped. The extension now keeps a local, session-only activity log (last 500 tab switches + which tab opened which) and derives "worked on together" clusters: switched between 3+ times within 5 minutes, or opened from one another; "opened ≤2 min apart" may only join clusters up to 8 tabs. Clusters ride along with the organize request as evidence; Claude may return zero groups, must give a one-line reason per group, and the user can rename a suggestion when saving it as a tag.

## Options considered

- **Strict keyword verification** (built, then not shipped) — every tab in a group must contain one of the group's keywords. Precise, but it would have rejected the correct Drive + Stripe group.
- **Reasons + rename only** — explains groups but gives Claude no new evidence.
- **Behavioral clusters + reasons + rename** (chosen).
- **No-AI cluster groups** ("Worked on together · 10:02–10:40") as a fallback — deferred (BACKLOG).

## Tradeoffs

- Gain: groups follow real work, not just vocabulary; every suggestion carries a reason; nothing behavioural leaves the browser except the derived clusters.
- Give up: a small per-switch storage write; clusters only help when both tabs are in the same organize request (cached tabs aren't resent); the switch log starts empty after a browser restart. Claude's use of the evidence has only been tested with a mocked client — validate on real traffic once the production Anthropic key is confirmed funded.
