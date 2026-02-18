import type { SummaryJson } from "@cliphy/shared";
import { summarizeTranscript } from "../src/services/summarizer.js";
import { fetchTranscript } from "../src/services/transcript.js";
import { runChecks, type CheckResult } from "./checks.js";
import { loadFixtures, saveFixture, type Fixture } from "./fixtures.js";

interface EvalResult {
  title: string;
  category: string;
  timeMs: number;
  summary: SummaryJson;
  checks: CheckResult[];
  error?: string;
}

function parseVideoId(url: string): string {
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  throw new Error(`Could not parse video ID from URL: ${url}`);
}

async function evalFixture(fixture: Fixture): Promise<EvalResult> {
  const start = Date.now();
  try {
    const result = await summarizeTranscript(fixture.transcript, fixture.title);
    const timeMs = Date.now() - start;
    const checks = runChecks(result, { retried: false });
    return { title: fixture.title, category: fixture.category, timeMs, summary: result, checks };
  } catch (err) {
    return {
      title: fixture.title,
      category: fixture.category,
      timeMs: Date.now() - start,
      summary: { summary: "", keyPoints: [], timestamps: [] },
      checks: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printResult(result: EvalResult) {
  const time = (result.timeMs / 1000).toFixed(1);
  console.log(`\n--- ${result.title} (${result.category}) ---`);

  if (result.error) {
    console.log(`  ERROR (${time}s): ${result.error}`);
    return;
  }

  console.log(`  OK (${time}s)`);
  for (const check of result.checks) {
    const icon = check.pass ? "\u2705" : "\u274C";
    console.log(`  ${check.name}: ${check.value} ${icon} (expected: ${check.expected})`);
  }
}

function printTotals(results: EvalResult[]) {
  const succeeded = results.filter((r) => !r.error);
  const allChecks = succeeded.flatMap((r) => r.checks);
  const passed = allChecks.filter((c) => c.pass).length;
  const total = allChecks.length;
  const avgTime = succeeded.reduce((sum, r) => sum + r.timeMs, 0) / succeeded.length / 1000;
  const wordCounts = succeeded.map((r) => r.summary.summary.split(/\s+/).filter(Boolean).length);
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  const avgKp =
    succeeded.reduce((sum, r) => sum + r.summary.keyPoints.length, 0) / succeeded.length;

  console.log(`\n=== TOTALS ===`);
  console.log(`  Videos: ${succeeded.length}/${results.length} succeeded`);
  console.log(`  Checks passed: ${passed}/${total}`);
  console.log(`  Avg time: ${avgTime.toFixed(1)}s`);
  console.log(`  Avg words: ${Math.round(avgWords)}`);
  console.log(`  Avg key points: ${avgKp.toFixed(1)}`);
}

function printMarkdown(results: EvalResult[]): string {
  const lines: string[] = [];
  lines.push("## Summary Eval Results\n");
  lines.push("| Video | Category | Time | Words | Key Points | Timestamps | Parse |");
  lines.push("|-------|----------|------|-------|------------|------------|-------|");

  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.title} | ${r.category} | - | ERROR | - | - | - |`);
      continue;
    }
    const time = (r.timeMs / 1000).toFixed(1) + "s";
    const words = r.summary.summary.split(/\s+/).filter(Boolean).length;
    const kp = r.summary.keyPoints.length;
    const ts = r.summary.timestamps.length;
    const checksMap = Object.fromEntries(r.checks.map((c) => [c.name, c.pass]));
    const icon = (ok: boolean) => (ok ? "\u2705" : "\u274C");
    lines.push(
      `| ${r.title} | ${r.category} | ${time} | ${words} ${icon(checksMap.summaryWords)} | ${kp} ${icon(checksMap.keyPoints)} | ${ts} ${icon(checksMap.timestamps)} | ${icon(checksMap.parseFirstTry)} |`,
    );
  }

  const succeeded = results.filter((r) => !r.error);
  if (succeeded.length > 0) {
    const avgTime = (succeeded.reduce((s, r) => s + r.timeMs, 0) / succeeded.length / 1000).toFixed(
      1,
    );
    const avgWords = Math.round(
      succeeded.reduce((s, r) => s + r.summary.summary.split(/\s+/).filter(Boolean).length, 0) /
        succeeded.length,
    );
    const avgKp = (
      succeeded.reduce((s, r) => s + r.summary.keyPoints.length, 0) / succeeded.length
    ).toFixed(1);
    lines.push(`| **Average** | | ${avgTime}s | ${avgWords} | ${avgKp} | | |`);
  }

  // Full output per video in collapsible sections
  lines.push("\n---\n");
  for (const r of results) {
    if (r.error) {
      lines.push(
        `<details>\n<summary><strong>${r.title}</strong> (${r.category}) — ERROR</summary>\n`,
      );
      lines.push(`\`\`\`\n${r.error}\n\`\`\`\n`);
      lines.push("</details>\n");
      continue;
    }
    lines.push(`<details>\n<summary><strong>${r.title}</strong> (${r.category})</summary>\n`);
    lines.push(`### Summary\n\n${r.summary.summary}\n`);
    lines.push(`### Key Points\n`);
    for (const kp of r.summary.keyPoints) {
      lines.push(`- ${kp}`);
    }
    lines.push(`\n### Timestamps\n`);
    for (const ts of r.summary.timestamps) {
      lines.push(`- ${ts}`);
    }
    lines.push("\n</details>\n");
  }

  return lines.join("\n");
}

// --- CLI ---

async function runFull(opts: { category?: string; videoIds?: string[] } = {}) {
  let fixtures = loadFixtures();
  if (opts.videoIds && opts.videoIds.length > 0) {
    fixtures = fixtures.filter((f) => opts.videoIds!.includes(f.videoId));
  } else if (opts.category) {
    fixtures = fixtures.filter((f) => f.category === opts.category);
  }
  if (fixtures.length === 0) {
    if (opts.videoIds) {
      console.error(`No fixtures found for video IDs: ${opts.videoIds.join(", ")}`);
    } else if (opts.category) {
      console.error(`No fixtures found for category "${opts.category}".`);
    } else {
      console.error("No fixtures found. Run: npx tsx apps/server/eval/seed-fixtures.ts");
    }
    process.exit(1);
  }
  const label = opts.videoIds
    ? `${fixtures.length} selected fixture(s)`
    : opts.category
      ? `${fixtures.length} "${opts.category}" fixtures`
      : `${fixtures.length} fixtures`;
  console.log(`Running eval on ${label}...\n`);
  const results: EvalResult[] = [];
  for (const fixture of fixtures) {
    const result = await evalFixture(fixture);
    printResult(result);
    results.push(result);
  }
  printTotals(results);

  // If GITHUB_STEP_SUMMARY is set, write markdown
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, printMarkdown(results) + "\n");
    console.log("\nMarkdown written to $GITHUB_STEP_SUMMARY");
  }
}

async function runOneOff(url: string, save: boolean) {
  const videoId = parseVideoId(url);
  console.log(`Fetching transcript for ${videoId}...`);

  let transcript: string;
  try {
    transcript = await fetchTranscript(videoId);
  } catch (err) {
    console.error(`\nFailed to fetch transcript: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`Transcript: ${transcript.length} chars`);

  const title = `Video ${videoId}`;
  const fixture: Fixture = { videoId, title, category: "one-off", transcript };

  console.log("Summarizing...");
  const result = await evalFixture(fixture);
  printResult(result);

  if (!result.error) {
    console.log(`\n--- Full Summary ---`);
    console.log(result.summary.summary);
    console.log(`\n--- Key Points ---`);
    result.summary.keyPoints.forEach((kp, i) => console.log(`  ${i + 1}. ${kp}`));
    console.log(`\n--- Timestamps ---`);
    result.summary.timestamps.forEach((ts) => console.log(`  ${ts}`));
  }

  if (save) {
    const path = saveFixture(fixture);
    console.log(`\nSaved fixture to ${path}`);
  }
}

// --- Entry point ---

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const catIndex = args.indexOf("--category");
const videosIndex = args.indexOf("--videos");
const save = args.includes("--save");

if (urlIndex !== -1 && args[urlIndex + 1]) {
  runOneOff(args[urlIndex + 1], save);
} else {
  const category = catIndex !== -1 ? args[catIndex + 1] : undefined;
  const videoIds =
    videosIndex !== -1 && args[videosIndex + 1]
      ? args[videosIndex + 1].split(",").map((id) => id.trim())
      : undefined;
  runFull({ category, videoIds });
}
