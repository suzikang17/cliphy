---
day: 12
date: 2026-03-03
phase: MVP
mood:
hours:
tags: []
published_to: []
public: false
title: "Day 12 — Truncation, Tests, Prompt Tuning, Summary Tags, Design Pass"
---

## Session Summary

Four sessions covering transcript handling, prompt tuning, summary tags, and a summaries page design pass. Added truncation warnings + duration blocking, built a Promptfoo eval system, shipped full tags CRUD with free-tier limits, then redesigned the summaries page with compact cards, search/filter toolbar, and inline tagging.

## What got done

- **Transcript truncation warning**: Transcripts >100k chars truncated with `truncated: true` on `SummaryJson`. Amber warning banner in `SummaryDetail.tsx`
- **Duration blocking**: Videos >3hr hard-blocked — disabled button in `VideoCard` ("Too Long"), server returns 400 `VIDEO_TOO_LONG`
- **`fetchTranscript`\*\*** return type\*\*: Now returns `{ text, truncated }` instead of `string`. Threaded through Inngest worker, eval scripts, test mocks
- **13 unit tests** for `summarize-video.ts` Inngest worker (happy path, truncation, error classification, retry logic, `onFailure` handler)
- **Prompt tuning system**: Promptfoo-based A/B eval with 4 structural checks + 4 LLM judge dimensions. `tune.ts` CLI with `--judge opus/sonnet` and `--category` flags
- **First eval results**: v2-detailed won 3/4 dimensions vs baseline (accuracy 0.82 vs 0.75, actionability 0.97 vs 0.92, timestamps 0.70 vs 0.40; baseline won conciseness 0.90 vs 0.88)
- **Summary tags**: `tags text[]` column + GIN index, `PATCH /summaries/:id/tags`, `GET /summaries/tags`, tag filter via `?tag=`, free user limit (3 unique tags), `TagLimitError` error class, tag chips + inline editor with datalist autocomplete
- **Summaries page redesign**: Compact cards (w-28 h-16 thumbnails, no TLDR preview), toolbar (instant search, tag filter, newest/oldest sort), hover delete with confirmation, "+ tag" badge button on cards, smart empty states, updated skeletons
- **`relativeDate()`\*\*** utility\*\*: Pure function — "Just now", "5m ago", "3h ago", "Yesterday", "Tue", "Mar 1"

## Decisions

- **Promptfoo** over Braintrust/LangSmith/Langfuse — open-source, local, no accounts, native Anthropic support
- **Sonnet default judge** with `--judge opus` flag — cheaper for rapid iteration, Opus for final comparisons
- **Client-side search** with `useMemo` — fast enough for ≤100 items, no API call needed
- **Compact list** over two-column dashboard — better for scanning, simpler implementation

## Issues

- **`APIError.generate()`\*\*** doesn't set status with undefined headers\*\*: Used `new APIError(status, { type: "error" }, message, undefined)` constructor directly in tests
- **`vi.clearAllMocks()`\*\*** wipes closure-captured mock calls\*\*: Fixed by capturing Inngest `createFunction` config in a module-level closure variable
- **User correction on truncation vs blocking**: Initially made transcript >100k a hard rejection. User pointed out we still need truncation for <3hr videos with long transcripts
- **TimestampQuality scoring 0.3**: Judge couldn't see transcript — injected `{{transcript}}` into rubric value, score improved to 0.7
- **"Summary not found" on page load**: Extension pointed at prod server without `/tags` route. `GET /api/summaries/tags` hit `GET /:id` with `id="tags"` → 404. Fix: made tags fetch non-fatal
- **CORS missing PATCH**: `allowMethods` didn't include PATCH — added it
- **3 \*\***`toSummary`\***\* mappers**: queue.ts, summaries.ts, extension/lib/supabase.ts all needed `tags` field

## What to remember

- Vitest `vi.clearAllMocks()` in `beforeEach` means you can't rely on mock call history from module-level `vi.mock()` factories — capture values in closures
- Anthropic SDK: `APIError` constructor signature is `(status, body, message, headers)` — `generate()` behaves differently with undefined headers
- Threading optional fields through JSONB columns avoids DB migrations — `truncated?: boolean` stored directly in `summary_json` column
- Promptfoo's `llm-rubric` only sees the output, not input vars — inject vars into rubric string if judge needs them
- Use `transform` in `defaultTest.options` to clean Claude's output before assertions
- The two 100k-char tutorial fixtures account for ~76% of token cost — use `--category` to skip during rapid iteration
- When adding a field to `Summary`, grep for all `toSummary` mappers — there are 3
- Extension points at prod server — new endpoints need deploying before they work

---

## Commits

- `ba63315` — add transcript unit tests, export pure functions for testability
- `d429682` — add promptfoo eval system with LLM-as-judge scoring
- `e31da64` — add tune.ts CLI wrapper, v2-detailed prompt variant
- `320f0e9` — fix prettier formatting in promptfooconfig.ts
- `acef6b8` — add summary tags with CRUD endpoints and UI
- `16195d1` — add summaries page design pass doc
- `530e980` — redesign summaries page with compact cards, toolbar, and inline tagging

---

## Task details

### Transcript Truncation + Duration Blocking

- `fetchTranscript` returns `{ text, truncated }`, Inngest worker threads flag into `summaryJson`
- Videos >3hr blocked at both UI (`VideoCard`) and API (`queue.ts`) with `MAX_VIDEO_DURATION_SECONDS` shared constant
- 13 unit tests covering happy path, truncation, error classification (retry vs non-retry), and `onFailure` handler

### Prompt Tuning System

- Promptfoo config with baseline.json + v2-detailed.json prompt variants
- 4 structural checks (JSON shape, key points count, timestamp format, summary word count) + 4 LLM judge dimensions (accuracy, conciseness, actionability, timestamp quality)
- `tune.ts` CLI: `pnpm eval:tune` with `--judge` and `--category` flags
- Eval README and design doc committed

### Summary Tags

- DB: `tags text[]` column + GIN index via migration `006_add_tags.sql`
- Server: PATCH tags (validate/normalize/dedupe/free-limit), GET unique tags, tag filter on list endpoint
- Extension: `updateSummaryTags()`, `getAllTags()`, `TagLimitError`, tag filter in `getSummaries()`
- UI: tag chips on cards, `TagEditor` in detail view, tag filter dropdown, "+ tag" badge on card hover

### Summaries Page Design Pass

- Compact cards: smaller thumbnails, relative dates, channel + duration, no TLDR preview
- Toolbar: instant search (`useMemo` filter), tag filter (server-side), sort (client-side reverse)
- Hover actions: delete with "Delete?" confirmation, "+ tag" badge button with inline input
- Empty states: no summaries / no search matches / no tag matches with clear filters
