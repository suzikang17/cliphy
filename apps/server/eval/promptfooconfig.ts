import type { UnifiedConfig } from "promptfoo";
import { loadFixtures } from "./fixtures.ts";

const fixtures = loadFixtures();

// Judge rubrics — direct quality criteria, no JSON preamble needed
// (per-assertion transforms extract the relevant prose before the judge sees it)
const RUBRICS = {
  accuracy: `Rate how accurately this captures the video's key ideas (0.0–1.0).
- 1.0: All major points faithful, nothing fabricated
- 0.7: Most key ideas present, minor omissions
- 0.4: Significant gaps or inaccuracies
- 0.0: Major fabrications or misses the point

Original transcript:
{{transcript}}`,

  conciseness: `Rate how concise and well-written this summary is (0.0–1.0).
- 1.0: Tight, no filler, captures essence in minimal words
- 0.7: Mostly concise, minor redundancy
- 0.4: Verbose or filler phrases
- 0.0: Bloated, repetitive, unfocused`,

  actionability: `Rate how useful and specific these points are (0.0–1.0).
- 1.0: Every point is specific, concrete, useful to someone who hasn't watched
- 0.7: Most useful, a few generic
- 0.4: Many vague or could apply to any video
- 0.0: All generic platitudes`,

  timestampQuality: `Rate timestamp quality (0.0–1.0).
- 1.0: Mark real topic changes, times match transcript markers, clear descriptions
- 0.7: Mostly accurate, minor timing issues
- 0.4: Several wrong or vague
- 0.0: Fabricated or missing

Original transcript with [M:SS] markers:
{{transcript}}`,
};

// Per-assertion transforms — extract prose from JSON so the judge never sees raw JSON
const TX = {
  summary: "JSON.parse(output).summary",
  accuracy:
    '(() => { const p = JSON.parse(output); return p.summary + "\\n\\nKey Points:\\n" + p.keyPoints.join("\\n"); })()',
  keyPoints:
    '(() => { const p = JSON.parse(output); const kp = p.keyPoints.join("\\n"); const ai = (p.actionItems||[]).join("\\n"); return "Key Points:\\n" + kp + (ai ? "\\n\\nAction Items:\\n" + ai : ""); })()',
  timestamps: 'JSON.parse(output).timestamps.join("\\n")',
};

const config: UnifiedConfig = {
  prompts: [
    { id: "file://prompts/baseline.json", label: "Baseline" },
    { id: "file://prompts/v2-detailed.json", label: "v2 Detailed" },
  ],

  providers: [
    {
      id: "anthropic:messages:claude-sonnet-4-6",
      config: {
        temperature: 0.3,
        max_tokens: 2048,
      },
    },
  ],

  defaultTest: {
    options: {
      provider: process.env.EVAL_JUDGE_MODEL ?? "anthropic:messages:claude-sonnet-4-6",
      // Strip markdown code fences that Claude sometimes adds despite instructions
      transform: 'output.replace(/^```(?:json)?\\s*\\n?|\\n?```\\s*$/g, "").trim()',
    },
  },

  tests: fixtures.map((f) => ({
    description: `[${f.category}] ${f.title}`,
    vars: {
      videoTitle: f.title,
      transcript: f.transcript,
    },
    assert: [
      {
        type: "llm-rubric" as const,
        value: RUBRICS.accuracy,
        metric: "Accuracy",
        transform: TX.accuracy,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.conciseness,
        metric: "Conciseness",
        transform: TX.summary,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.actionability,
        metric: "Actionability",
        transform: TX.keyPoints,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.timestampQuality,
        metric: "TimestampQuality",
        transform: TX.timestamps,
      },
    ],
  })),
};

export default config;
