---
type: decision
title: "Jev classifies tags, Claude generates them; auto-tag every summary for all plans"
date: 2026-10-09
category: AI
revisit: true
---

## Why this choice

First slice of moving AI into Cliphy's core: tagging should happen automatically, not behind a Pro-only "✨ Auto-tag" button. Running a Claude call per summary just to pick tags is slow and overkill for what is really a classification problem. TypeSafe's Jev is built for exactly that — typed yes/no and choice questions answered in parallel, cheaply — but it cannot invent tag names. So the work is split: the existing Claude summary call additionally returns 2–4 `topics` (no extra request), and a new `auto-tag` Inngest step asks Jev (a) one yes/no per existing user tag, auto-applying those ≥ 0.7, and (b) for each topic, which existing tag it duplicates (or none). Unmatched topics are stored in `clips.suggested_tags` and shown as accept/dismiss chips in extension, web and mobile.

## Options considered

- **Keep Claude Haiku for everything, just run it automatically** — simplest, one provider, but every summary pays a second LLM round-trip and the output is free text we parse/whitelist.
- **Jev for everything** — impossible: Jev can't generate new tag names.
- **Embeddings similarity (Voyage) against tag names** — no prompt, but tag names are 1–3 words; similarity on such short strings is noisy and needs a hand-tuned threshold per user.
- **Auto-create new tags (vs. suggest)** — fully hands-off, but tag lists sprawl with one-offs; rejected in favor of suggestions for new tags while existing tags apply silently.

## Tradeoffs

- Gain: AI tagging for every clip on every plan at near-zero marginal cost; duplicate-tag collapsing (`ml` vs `machine learning`); one shared tagger (`services/tagger.ts`) behind the pipeline step and the manual auto-tag endpoints.
- Give up: a second AI vendor (key management, an outage surface — mitigated by the step being best-effort), and a young vendor whose signups are paused. Claude Haiku stays as fallback for summaries that predate `topics` and when no key is configured.
- Thresholds (0.7 apply / 0.5 duplicate) are guesses to tune on real clips; Jev model pinned to `jev-1.13.0` so results don't drift. `revisit: true` once we have a few weeks of accept/dismiss data.
- Free plan's 3-unique-tag cap still applies on accepting a suggestion; auto-applying existing tags never adds new unique tags so it can't breach it.
