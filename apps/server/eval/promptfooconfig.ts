import type { UnifiedConfig } from "promptfoo";
import { loadFixtures } from "./fixtures.ts";

const fixtures = loadFixtures();

// Judge rubrics — each assesses a distinct quality dimension
const RUBRICS = {
  faithfulness: `Rate how faithfully this represents the video's actual content (0.0–1.0).
The video title is: {{videoTitle}}

- 1.0: All claims are supported by the transcript. No hallucinated facts, names, or details. Major points are all covered — nothing important is left out.
- 0.7: Mostly faithful, but minor omissions of secondary points or slight imprecision in details.
- 0.4: Contains noticeable errors — invented details, misattributed claims, or misses a major topic from the video.
- 0.0: Substantially fabricated or misrepresents what the video is about.

Original transcript:
{{transcript}}`,

  usefulness: `Rate how useful this is to someone who wants to skip the video (0.0–1.0).

- 1.0: After reading this, you'd have a clear understanding of what the video covers and its key insights. Every point is specific to THIS video — names, numbers, concrete takeaways. You wouldn't need to watch it.
- 0.7: Mostly useful, but some points are vague or could apply to any video on this topic.
- 0.4: Generic summary that gives you the gist but misses the specific insights that make this video worth watching.
- 0.0: So vague or generic that you'd learn almost nothing. Could describe any video in the same category.`,

  timestamps: `Rate the quality of these timestamps (0.0–1.0).

- 1.0: Times align with [M:SS] markers in the transcript and mark real topic transitions. Labels are descriptive enough to navigate by — you could jump to the part you care about.
- 0.7: Most times are accurate and labels are useful, with minor issues (a vague label, slightly off timing).
- 0.4: Several timestamps are wrong, labels are generic ("next topic", "continued"), or timestamps miss major topic changes.
- 0.0: Timestamps are fabricated, completely off, or labels are meaningless.

Original transcript with [M:SS] markers:
{{transcript}}`,

  contextSection: `Rate how well this context section serves the reader (0.0–1.0).
The video title is: {{videoTitle}}

Ask: does this section give the reader something they can USE, formatted the way they'd naturally want it?

- 1.0: Title, structure, and items are tailored to this specific video. A recipe separates ingredients from steps. A review lists pros and cons. A lecture pulls out key concepts. A how-to gives concrete steps. Items are specific to THIS video, not generic advice.
- 0.7: Section is relevant and useful, but format is generic — e.g. a recipe as a flat bullet list instead of ingredients + steps, or items that are accurate but not structured for quick reference.
- 0.4: Section adds little value — items are vague, title/format doesn't match the content, or it repeats the key points.
- 0.0: Section is missing when it should exist (e.g. recipe video with no recipe), exists when it shouldn't (music video with forced "action items"), or items are unhelpful.

Null is correct for entertainment, music, vlogs, or very short content. Rate whether null was the right call.

Original transcript:
{{transcript}}`,

  readability: `Rate how well-written and structured the entire output is (0.0–1.0).

- 1.0: Concise and tight — no filler words, no redundancy between sections. Summary is a punchy TL;DR. Key points don't repeat the summary. Each section adds distinct value. Easy to scan.
- 0.7: Mostly clean, but minor issues — a filler phrase, slight overlap between summary and key points, or a point that could be tighter.
- 0.4: Verbose, redundant, or poorly organized. Summary restates what key points say. Multiple points make the same observation.
- 0.0: Bloated, repetitive, hard to scan. Sections blur together with no distinct purpose.`,
};

// Per-assertion transforms — extract prose from JSON so the judge never sees raw JSON
// Helper: render contextSection including groups if present (single-line for Promptfoo eval)
const CS =
  'function r(cs){if(!cs)return"";var t="\\n\\n"+cs.title+":\\n";if(cs.groups&&cs.groups.length>0){t+=cs.groups.map(function(g){return g.label+":\\n"+g.items.join("\\n")}).join("\\n\\n")}else if(cs.items&&cs.items.length>0){t+=cs.items.join("\\n")}return t}';

const TX = {
  // Faithfulness + Usefulness: judge sees summary + key points + context section
  full: `(() => { ${CS}; const p = JSON.parse(output); return "Summary:\\n" + p.summary + "\\n\\nKey Points:\\n" + p.keyPoints.join("\\n") + r(p.contextSection); })()`,
  // Timestamps: just the timestamp lines
  timestamps: 'JSON.parse(output).timestamps.join("\\n")',
  // Context section: rendered with groups
  contextSection: `(() => { ${CS}; const p = JSON.parse(output); const cs = p.contextSection; if (!cs) return "Context section: null (not included)"; return "Section: " + cs.title + " " + cs.icon + r(cs); })()`,
  // Readability: the entire output as prose
  everything: `(() => { ${CS}; const p = JSON.parse(output); var out = "Summary: " + p.summary + "\\n\\nKey Points:\\n" + p.keyPoints.join("\\n"); out += r(p.contextSection); out += "\\n\\nTimestamps:\\n" + p.timestamps.join("\\n"); return out; })()`,
};

const config: UnifiedConfig = {
  prompts: [
    { id: "file://prompts/baseline.json", label: "Baseline" },
    { id: "file://prompts/v2-detailed.json", label: "v2 Detailed" },
    { id: "file://prompts/v3-groups.json", label: "v3 Groups" },
  ],

  cache: true,

  providers: [
    {
      id: "anthropic:messages:claude-haiku-4-5-20251001",
      config: {
        temperature: 0.3,
        max_tokens: 2048,
      },
    },
  ],

  defaultTest: {
    options: {
      provider: process.env.EVAL_JUDGE_MODEL ?? "anthropic:messages:claude-haiku-4-5-20251001",
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
        value: RUBRICS.faithfulness,
        metric: "Faithfulness",
        transform: TX.full,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.usefulness,
        metric: "Usefulness",
        transform: TX.full,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.timestamps,
        metric: "Timestamps",
        transform: TX.timestamps,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.contextSection,
        metric: "ContextSection",
        transform: TX.contextSection,
      },
      {
        type: "llm-rubric" as const,
        value: RUBRICS.readability,
        metric: "Readability",
        transform: TX.everything,
      },
    ],
  })),
};

export default config;
