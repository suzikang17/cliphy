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

  timestampDetail: `Rate how descriptive and useful these timestamp labels are (0.0–1.0).
- 1.0: Each label clearly describes the topic/segment, specific enough to navigate by
- 0.7: Most labels are descriptive, a few are vague
- 0.4: Many labels are generic ("next section") or too brief to be useful
- 0.0: Labels are missing, meaningless, or all identical`,

  timestampAccuracy: `Rate how accurately these timestamps match real topic transitions (0.0–1.0).
- 1.0: Times align with [M:SS] markers in the transcript, each marks a real topic change
- 0.7: Most times are close, minor drift
- 0.4: Several times are wrong or don't correspond to topic changes
- 0.0: Times are fabricated or completely off

Original transcript with [M:SS] markers:
{{transcript}}`,
};

// Per-assertion transforms — extract prose from JSON so the judge never sees raw JSON
const TX = {
  summary: "JSON.parse(output).summary",
  accuracy:
    '(() => { const p = JSON.parse(output); return p.summary + "\\n\\nKey Points:\\n" + p.keyPoints.join("\\n"); })()',
  keyPoints:
    '(() => { const p = JSON.parse(output); const kp = p.keyPoints.join("\\n"); const cs = p.contextSection; const csText = cs ? "\\n\\n" + cs.title + ":\\n" + cs.items.join("\\n") : ""; return "Key Points:\\n" + kp + csText; })()',
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
        value: RUBRICS.timestampDetail,
        metric: "TimestampDetail",
        transform: TX.timestamps,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.timestampAccuracy,
        metric: "TimestampAccuracy",
        transform: TX.timestamps,
      },
    ],
  })),
};

export default config;
