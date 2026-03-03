import type { UnifiedConfig } from "promptfoo";
import { loadFixtures } from "./fixtures.ts";

const fixtures = loadFixtures();

// Judge rubric instructions — kept terse to minimize token cost
const RUBRICS = {
  accuracy: `You are evaluating a JSON summary of a YouTube video transcript.
Rate how accurately the summary captures the video's key ideas on a scale of 0.0 to 1.0.
- 1.0: All major points captured faithfully, nothing fabricated
- 0.7: Most key ideas present, minor omissions
- 0.4: Significant gaps or minor inaccuracies
- 0.0: Major fabrications or completely misses the point
The original transcript is included in the prompt for reference.`,

  conciseness: `You are evaluating a JSON summary of a YouTube video.
Rate how concise and well-written the "summary" field is on a scale of 0.0 to 1.0.
- 1.0: Tight, no filler, captures essence in minimal words
- 0.7: Mostly concise with minor redundancy
- 0.4: Verbose or contains filler phrases
- 0.0: Bloated, repetitive, or unfocused
Judge ONLY the "summary" field, not keyPoints or other fields.`,

  actionability: `You are evaluating a JSON summary of a YouTube video.
Rate how useful and specific the "keyPoints" and "actionItems" arrays are on a scale of 0.0 to 1.0.
- 1.0: Every point is specific, concrete, and genuinely useful to someone who hasn't watched the video
- 0.7: Most points are useful, a few are generic
- 0.4: Many points are vague or could apply to any video
- 0.0: All points are generic platitudes
If actionItems is empty, judge only keyPoints.`,

  timestampQuality: `You are evaluating a JSON summary of a YouTube video transcript.
Rate the quality of the "timestamps" array on a scale of 0.0 to 1.0.
- 1.0: Timestamps mark real topic changes, times match [M:SS] markers in the transcript, descriptions are clear
- 0.7: Most timestamps are accurate, minor timing issues
- 0.4: Several timestamps are wrong or descriptions are vague
- 0.0: Timestamps are fabricated or missing

Here is the original transcript with [M:SS] time markers — use these to verify the timestamps are accurate:
{{transcript}}`,
};

// Structural assertions (free, instant)
const structuralAssertions = [
  {
    type: "is-json" as const,
    metric: "ValidJSON",
  },
  {
    type: "javascript" as const,
    value: `
      const parsed = JSON.parse(output);
      const words = parsed.summary.split(/\\s+/).filter(Boolean).length;
      return { pass: words <= 50, score: words <= 50 ? 1 : 0, reason: \`Summary word count: \${words}\` };
    `,
    metric: "SummaryLength",
  },
  {
    type: "javascript" as const,
    value: `
      const parsed = JSON.parse(output);
      const count = parsed.keyPoints.length;
      return { pass: count >= 5 && count <= 10, score: count >= 5 && count <= 10 ? 1 : 0, reason: \`Key points: \${count}\` };
    `,
    metric: "KeyPointCount",
  },
  {
    type: "javascript" as const,
    value: `
      const parsed = JSON.parse(output);
      const count = parsed.timestamps.length;
      return { pass: count >= 2, score: count >= 2 ? 1 : 0, reason: \`Timestamps: \${count}\` };
    `,
    metric: "TimestampCount",
  },
];

// LLM rubric assertions (costs $, uses judge model)
const rubricAssertions = [
  { type: "llm-rubric" as const, value: RUBRICS.accuracy, metric: "Accuracy" },
  { type: "llm-rubric" as const, value: RUBRICS.conciseness, metric: "Conciseness" },
  { type: "llm-rubric" as const, value: RUBRICS.actionability, metric: "Actionability" },
  { type: "llm-rubric" as const, value: RUBRICS.timestampQuality, metric: "TimestampQuality" },
];

const config: UnifiedConfig = {
  prompts: ["file://prompts/baseline.json", "file://prompts/v2-detailed.json"],

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
      provider: "anthropic:messages:claude-sonnet-4-6",
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
    assert: [...structuralAssertions, ...rubricAssertions],
  })),
};

export default config;
