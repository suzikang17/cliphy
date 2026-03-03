# Prompt Tuning

LLM-as-judge prompt evaluation with A/B comparison using [Promptfoo](https://promptfoo.dev).

## Quick Start

```bash
# A/B eval on a cheap fixture (~$0.30)
pnpm eval:tune --category tutorial

# Full suite, all 9 fixtures (~$1.76)
pnpm eval:tune

# View results in browser
pnpm eval:tune:view
```

## Writing a New Prompt Variant

1. Copy `prompts/baseline.json` → `prompts/v3-whatever.json`
2. Edit the system/user message content
3. Add it to the `prompts` array in `promptfooconfig.ts`
4. Quick-test: `pnpm eval:tune --category tutorial`
5. Full run: `pnpm eval:tune`

### Prompt format

JSON array of OpenAI-style messages. Promptfoo translates to Anthropic format automatically. Use `{{videoTitle}}` and `{{transcript}}` as Nunjucks variables.

```json
[
  { "role": "system", "content": "Your system prompt here..." },
  {
    "role": "user",
    "content": "Summarize this YouTube video.\n\nVideo title: {{videoTitle}}\n\nTranscript:\n{{transcript}}"
  }
]
```

## Flags

| Flag                | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `--category <name>` | Filter fixtures: `short`, `tutorial`, `music`, `lecture`, `explainer`, `long` |
| `--judge opus`      | Use Opus as judge (more capable, ~30% more expensive)                         |
| `--judge sonnet`    | Explicit Sonnet judge (default)                                               |

Extra promptfoo flags work when running directly:

```bash
cd apps/server && npx promptfoo eval -c eval/promptfooconfig.ts --env-file ../../.env \
  --filter-pattern "Fireship" \
  -o eval/results/my-run.json \
  --no-cache
```

## Scoring

### Structural Checks (free, instant)

| Check          | Rule                  |
| -------------- | --------------------- |
| ValidJSON      | Output parses as JSON |
| SummaryLength  | Summary ≤ 50 words    |
| KeyPointCount  | 5–10 key points       |
| TimestampCount | ≥ 2 timestamps        |

### LLM Judge Dimensions (0.0–1.0)

| Dimension        | What it measures                                             |
| ---------------- | ------------------------------------------------------------ |
| Accuracy         | Does the summary faithfully represent the video's key ideas? |
| Conciseness      | Is the summary tight, no filler or repetition?               |
| Actionability    | Are key points specific and useful, not generic?             |
| TimestampQuality | Do timestamps mark real topic changes at correct times?      |

## Workflow

```
Edit prompt JSON → pnpm eval:tune --category tutorial → check scores
       ↑                                                    │
       └────────────── tweak and repeat ────────────────────┘
```

When happy with a variant, copy its content back into `src/lib/prompts.ts` to make it the production prompt.

## Cost Estimates

| Scenario                         | Sonnet judge | Opus judge |
| -------------------------------- | ------------ | ---------- |
| A/B run (2 variants, 9 fixtures) | ~$1.76       | ~$2.54     |
| Quick run (skip long fixtures)   | ~$0.55       | ~$0.80     |
| Single fixture test              | ~$0.15       | ~$0.20     |

The two 100k-char tutorials account for ~76% of token cost. Use `--category` to skip them during rapid iteration.

## File Layout

```
apps/server/eval/
├── promptfooconfig.ts       # Promptfoo config (loads fixtures, defines assertions)
├── tune.ts                  # CLI wrapper (--judge, --category flags)
├── prompts/
│   ├── baseline.json        # Current production prompt
│   └── v2-detailed.json     # Sample variant
├── fixtures/                # Transcript fixtures (9 videos)
├── results/                 # Eval output JSON (gitignored)
├── run-eval.ts              # Original structural-only eval (still works)
└── checks.ts                # Original structural checks
```
