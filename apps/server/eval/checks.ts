import type { SummaryJson } from "@cliphy/shared";

export interface CheckResult {
  name: string;
  pass: boolean;
  value: number | string;
  expected: string;
}

export interface CheckContext {
  retried: boolean;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function runChecks(summary: SummaryJson, ctx: CheckContext): CheckResult[] {
  const words = wordCount(summary.summary);

  return [
    {
      name: "summaryWords",
      pass: words >= 200 && words <= 800,
      value: words,
      expected: "200-800",
    },
    {
      name: "keyPoints",
      pass: summary.keyPoints.length >= 5 && summary.keyPoints.length <= 10,
      value: summary.keyPoints.length,
      expected: "5-10",
    },
    {
      name: "timestamps",
      pass: summary.timestamps.length >= 2,
      value: summary.timestamps.length,
      expected: ">=2",
    },
    {
      name: "parseFirstTry",
      pass: !ctx.retried,
      value: ctx.retried ? "retried" : "first try",
      expected: "first try",
    },
  ];
}
