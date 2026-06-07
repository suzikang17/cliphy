---
day: 3
date: 2026-02-18
phase: MVP
mood: 😎 Smooth
hours:
tags: []
published_to: []
public: false
title: "Day 3 — First e2e summary working"
---

## Session summary

Wired the core value prop end-to-end: transcript fetch → Claude Sonnet 4.6 → structured JSON summary. Smoke tested on 3 real videos, all passed. Then built a full eval pipeline with 9 cached fixtures, structural quality checks, CLI with category/video filtering, and a manually-triggered GitHub Action with full summary output in the report. 14 commits across 2 tasks.

## What got done

- First e2e summary pipeline working: transcript fetch → Claude Sonnet 4.6 → structured JSON output
- Smoke tested 3 real videos (short, tutorial, music) — all passed (bf0330f)
- Built eval pipeline: 9 cached fixtures, structural quality checks, CLI + GitHub Action
- First eval run: 31/36 checks passed, 100% JSON parse success
- Added category/video filtering and full summary output to GHA report (16b902b)

## Decisions

- **Sonnet 4.6 over 4.5** — released Feb 17, same price, 1M context window. No reason not to.
- **Schema: summary + keyPoints + timestamps** — lean for MVP. tldr and actionItems via templates later.
- **Anti-injection in system prompt** — transcript framed as untrusted user content.
- **Cached fixtures for CI eval, not live YouTube** — YouTube blocks GH Actions runner IPs. Live fetching is local-only via `pnpm eval:add`.

## Issues

- Anthropic account had no credits — API returned 400. Topped up and re-ran successfully.
- `node --env-file` doesn't work with tsx — use `set -a && source .env && set +a && npx tsx` instead.
- `tsx` not found in CI — was only in `apps/server/devDependencies`. Fixed by adding to root (3c16111).
- Unhandled crash in eval one-off mode when transcript fetch fails — added try/catch (2d1295a).
- Video `rodcdKuwH3o` returns "no captions" in GHA but works locally (67811 chars) — YouTube IP-blocks GitHub Actions runners.
- `summaryWords` check failing on short/music videos (avg 174 words vs 200 min) — prompt tuning needed (Day 5 task).

## What to remember

- Server needs env vars sourced manually: `set -a && source .env && set +a`
- Smoke test: start server first, then run `npx tsx apps/server/scripts/smoke-test-summary.ts`
- YouTube transcript fetching is unreliable from CI environments — always use cached fixtures
- Add new eval videos locally: `pnpm eval:add -- <youtube-url>`

---

## Commits

- `2b21921` — update SummaryJson: replace tldr with summary field
- `02b0e49` — rewrite summarizer with Sonnet 4.6, JSON parsing, and retry logic
- `51c2285` — add POST /api/summarize route wiring transcript to Claude
- `95539b5` — add e2e summary design and implementation plan
- `bf0330f` — add smoke test script for e2e summary pipeline
- `6cd7499` — add structural quality checks for summary eval
- `8aa72ff` — add eval fixtures: transcript cache for 10 YouTube videos
- `0cb6a45` — add eval runner with full, one-off, and save modes
- `241ba17` — add GitHub Action for manual summary eval
- `07228e3` — add eval pipeline design doc
- `021e846` — add eval pipeline implementation plan
- `3c16111` — add tsx to root devDependencies for eval script in CI
- `2d1295a` — handle transcript fetch errors gracefully in eval one-off mode
- `16b902b` — add category/video filtering, eval:add script, and full summary output to eval report

## Task details

### Get first e2e summary working (transcript → Claude → output)

- Updated `SummaryJson` type: replaced `tldr` with `summary` field (2b21921)
- Rewrote prompt template with system/user split + anti-injection defense (02b0e49)
- Rebuilt summarizer service: Sonnet 4.6, JSON parsing with code-fence stripping, retry on parse failure, 4 unit tests (02b0e49)
- Added `POST /api/summarize` route wiring transcript fetch to Claude (51c2285)
- Smoke tested 3 real videos — all returned structured summaries (bf0330f)

### Build summary eval pipeline (GitHub Action + CLI)

- Built quality checks module: summaryWords (200-800), keyPoints (5-10), timestamps (>=2), parseFirstTry. 5 unit tests (6cd7499)
- Seeded 9 transcript fixtures across 6 categories — CSS in 100s failed (no captions) (8aa72ff)
- Built eval runner with 3 modes: full, one-off (`--url`), save (`--save`) (0cb6a45)
- Added GitHub Action with `workflow_dispatch`: category dropdown + video ID text input (241ba17, 16b902b)
- Added `eval:add` npm script for saving new fixtures locally (16b902b)
- Full summary output in collapsible `<details>` sections in GHA report (16b902b)
- Removed live YouTube URL input from GHA after discovering IP blocking (16b902b)
