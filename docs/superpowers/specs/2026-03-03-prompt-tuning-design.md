# Prompt Tuning System Design

## Goal

Evaluate and iterate on the summarizer prompt using LLM-as-judge scoring and A/B comparison. Build trust with manual review first, then unlock auto-iterate.

## Approach

**Promptfoo** for eval execution, LLM-as-judge scoring, and A/B comparison. Custom auto-iterate script on top for Phase 2.

- Phase 1: A/B comparison — manually write prompt variants, run side-by-side, Sonnet judges, you review scores and decide
- Phase 2: Auto-iterate — once you trust the judge, flip `--auto-iterate` and let Opus propose prompt mutations automatically

## Architecture

```
prompts/*.json ──→ Promptfoo eval ──→ LLM judge scores (0-1 per dimension)
                        ↑                      │
                        │                      ↓
                   (Phase 2)           results/<timestamp>.json
                   auto-iterate ←── read scores, propose mutations
```

## File layout

```
apps/server/eval/
├── promptfooconfig.ts           # Promptfoo config (TS — loads fixtures programmatically)
├── prompts/
│   ├── baseline.json            # Current production prompt (extracted from prompts.ts)
│   └── v2.json                  # New variant to test
├── fixtures/                    # (existing) transcript fixtures
├── checks.ts                   # (existing) structural checks
├── run-eval.ts                 # (existing) keep for quick structural-only eval
└── results/                    # Promptfoo JSON output history
```

## Prompt variant format

Each variant is a JSON file with the OpenAI-style message array. Promptfoo translates to Anthropic format automatically.

```json
[
  {
    "role": "system",
    "content": "You are a video summarizer..."
  },
  {
    "role": "user",
    "content": "Summarize this YouTube video.\n\nVideo title: {{videoTitle}}\n\nTranscript:\n{{transcript}}"
  }
]
```

Variables `{{videoTitle}}` and `{{transcript}}` are substituted from test case vars via Nunjucks.

## Config

TypeScript config so we can programmatically load fixture files.

```typescript
// promptfooconfig.ts
const config: UnifiedConfig = {
  prompts: ["file://prompts/baseline.json", "file://prompts/v2.json"],
  providers: [
    {
      id: "anthropic:messages:claude-sonnet-4-6",
      config: { temperature: 0.3, max_tokens: 2048 },
    },
  ],
  defaultTest: {
    options: {
      provider: "anthropic:messages:claude-sonnet-4-6", // default judge
      transform: "JSON.parse(output)",
    },
  },
  tests: fixtures.map((f) => ({
    vars: { videoTitle: f.title, transcript: f.transcript },
    assert: [
      // Structural checks (free, instant)
      { type: "is-json", metric: "ValidJSON" },
      { type: "javascript", value: "/* word count 200-800 */", metric: "WordCount" },
      { type: "javascript", value: "/* keyPoints 5-10 */", metric: "KeyPoints" },
      { type: "javascript", value: "/* timestamps >= 2 */", metric: "Timestamps" },
      // LLM judge (costs $)
      { type: "llm-rubric", value: "...accuracy rubric...", metric: "Accuracy" },
      { type: "llm-rubric", value: "...conciseness rubric...", metric: "Conciseness" },
      { type: "llm-rubric", value: "...actionability rubric...", metric: "Actionability" },
      { type: "llm-rubric", value: "...timestamp quality rubric...", metric: "TimestampQuality" },
    ],
  })),
};
```

## Scoring

All scores are 0.0–1.0 (Promptfoo's native scale for `llm-rubric`).

### Structural checks (pass/fail)

| Metric     | Rule                         |
| ---------- | ---------------------------- |
| ValidJSON  | Output parses as JSON        |
| WordCount  | summary word count 200–800   |
| KeyPoints  | keyPoints array length 5–10  |
| Timestamps | timestamps array length >= 2 |

### LLM judge dimensions (0.0–1.0)

| Dimension            | Rubric summary                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| **Accuracy**         | Does the summary faithfully represent the video's key ideas? Nothing fabricated or missed? |
| **Conciseness**      | Is the summary tight? No filler, no repetition, well within the 2-sentence constraint?     |
| **Actionability**    | Are key points specific and useful (not generic)? Action items practical and concrete?     |
| **TimestampQuality** | Do timestamps mark real topic changes at correct times from the transcript?                |

Each `llm-rubric` assertion gets the `metric` property so scores display as separate columns in results.

## Judge model

- **Default: Sonnet 4.6** — cheaper for rapid iteration during Phase 1
- **Flag: `--judge opus`** — upgrade to Opus for final comparisons or if Sonnet scores feel inflated

## CLI commands

```bash
# A/B comparison — all variants against all fixtures
pnpm eval:tune

# Specific variant only
pnpm eval:tune --prompt baseline

# Filter by fixture category
pnpm eval:tune --category tutorial

# Use Opus as judge
pnpm eval:tune --judge opus

# Save results to file
pnpm eval:tune -o results/2026-03-03.json

# Web UI for interactive comparison
pnpm eval:tune:view

# Phase 2 (future)
pnpm eval:tune --auto-iterate --max-rounds 5
```

## Cost per A/B run (2 variants, 9 fixtures)

### Sonnet judge (default)

| Component                    | Input tokens | Output tokens |      Cost |
| ---------------------------- | -----------: | ------------: | --------: |
| Sonnet summarizer (18 calls) |     ~134,000 |       ~14,000 |     $0.61 |
| Sonnet judge (72 calls)      |     ~331,000 |       ~10,800 |     $1.15 |
| **Total**                    |              |               | **$1.76** |

### Opus judge (--judge opus)

| Component                    | Input tokens | Output tokens |      Cost |
| ---------------------------- | -----------: | ------------: | --------: |
| Sonnet summarizer (18 calls) |     ~134,000 |       ~14,000 |     $0.61 |
| Opus judge (72 calls)        |     ~331,000 |       ~10,800 |     $1.93 |
| **Total**                    |              |               | **$2.54** |

The two 100k-char fixtures (Python/JS tutorials) account for ~76% of token cost.

## Optimization levers

### Category filtering

Skip expensive long fixtures during rapid iteration:

```bash
pnpm eval:tune --category tutorial,lecture   # ~$0.55 per run
pnpm eval:tune                               # full suite when ready
```

### Prompt caching

Promptfoo supports Anthropic's prompt caching. The system prompt is identical across calls — cache reads are 90% cheaper on input. Biggest win on the judge calls where the rubric is repeated.

### Batch API

Anthropic's batch API gives 50% off all token costs. If real-time results aren't needed (e.g., overnight runs), batch drops a full A/B run to ~$0.88.

### Skip transcript for cheap dimensions

Conciseness and actionability can be judged from the summary alone — no need to send the source transcript. Only accuracy and timestamp quality need the transcript for verification. Structure rubrics accordingly to minimize input tokens on those 2 dimensions.

### Structural-only quick check

The existing `pnpm eval` still works for free, instant structural checks (word count, parse success, array lengths). Use it as a gate before spending on LLM judge runs.

## Phase 2: Auto-iterate (future)

When scores from Phase 1 are trusted:

1. Read latest Promptfoo results JSON
2. Send scores + current prompt + judge rationales to Opus: "Propose a better prompt variant that addresses the lowest-scoring dimensions"
3. Write new `prompts/v{n+1}.json`
4. Re-run Promptfoo eval
5. Repeat until scores plateau or `--max-rounds` hit
6. Present best variant for human approval

Guard rails:

- Max rounds cap (default 5) to prevent runaway costs
- Human approval required before any variant becomes the new baseline
- All variants saved to git for audit trail

## Dependencies

```bash
pnpm --filter server add -D promptfoo
```

No other new dependencies. Promptfoo runs locally, no accounts or SaaS.
