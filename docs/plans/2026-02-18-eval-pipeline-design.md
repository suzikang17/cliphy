# Summary Eval Pipeline Design

**Date:** 2026-02-18 (Day 3)
**Status:** Approved

## Goal

Build a prompt/summary quality evaluation system with CLI for local testing and GitHub Action for shareable results.

## Modes

1. **Full eval** (`pnpm eval`) — run all cached fixtures through summarizer, output structural checks + formatted results
2. **One-off** (`pnpm eval --url <youtube-url>`) — fetch live transcript, summarize, print results with quality checks
3. **Save to set** (`pnpm eval --url <youtube-url> --save`) — same as one-off but also saves transcript as a new fixture

## Fixtures

Cached transcripts in `apps/server/eval/fixtures/` as JSON:

```json
{
  "videoId": "jNQXAC9IVRw",
  "title": "Me at the zoo",
  "category": "short",
  "transcript": "..."
}
```

Initial set: ~10 videos across categories (short, tutorial, interview, lecture, music, news).

## Structural Quality Checks

Per summary:

- `keyPoints` count: 5-10
- `summary` word count: 200-800
- `timestamps` count: >= 2
- JSON parsed on first try (no retry needed)
- Response time in seconds

## CLI Output

```
--- Me at the zoo (short) ---
  OK (8.0s)
  Summary: 250 words ✅
  Key points: 6 ✅
  Timestamps: 3 ✅
  Parse: first try ✅

--- Fireship 100s (tutorial) ---
  OK (22.5s)
  Summary: 310 words ✅
  Key points: 10 ✅
  Timestamps: 11 ✅
  Parse: first try ✅

=== TOTALS ===
  Passed: 10/10
  Avg time: 15.2s
  Avg words: 280
  Avg key points: 7.5
  Parse success: 100%
```

## GitHub Action

- Trigger: `workflow_dispatch` only (manual)
- Optional input: `video_url` for one-off run
- Secret: `ANTHROPIC_API_KEY`
- Output: markdown table rendered in `$GITHUB_STEP_SUMMARY`
- Runs eval script, captures output, formats as Job Summary

## Architecture

```
apps/server/
  eval/
    fixtures/           # cached transcript JSON files
    run-eval.ts         # main eval runner (full + one-off + save)
    checks.ts           # structural quality check functions
  scripts/
    smoke-test-summary.ts  # (existing, can be deprecated later)
```

The eval script imports `summarizeTranscript` and `fetchTranscript` directly — no HTTP server needed.
