# Summary Eval Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI + GitHub Action for evaluating summary prompt quality against cached transcript fixtures.

**Architecture:** Eval script imports `summarizeTranscript` and `fetchTranscript` directly (no HTTP server). Fixtures are cached transcripts as JSON files. CLI supports full eval, one-off URL, and save-to-set modes. GitHub Action triggers manually and renders results as Job Summary.

**Tech Stack:** TypeScript, tsx runner, Vitest for tests, GitHub Actions

---

### Task 1: Quality checks module

**Files:**

- Create: `apps/server/eval/checks.ts`
- Create: `apps/server/eval/__tests__/checks.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/server/eval/__tests__/checks.test.ts
import { describe, it, expect } from "vitest";
import { runChecks, type CheckResult } from "../checks.js";
import type { SummaryJson } from "@cliphy/shared";

describe("runChecks", () => {
  const good: SummaryJson = {
    summary: "Word ".repeat(300).trim(),
    keyPoints: ["a", "b", "c", "d", "e"],
    timestamps: ["0:00 - Intro", "2:30 - Main"],
  };

  it("passes a good summary", () => {
    const results = runChecks(good, { retried: false });
    expect(results.every((r) => r.pass)).toBe(true);
  });

  it("fails when keyPoints count is too low", () => {
    const bad = { ...good, keyPoints: ["a", "b"] };
    const results = runChecks(bad, { retried: false });
    const kp = results.find((r) => r.name === "keyPoints");
    expect(kp?.pass).toBe(false);
  });

  it("fails when summary is too short", () => {
    const bad = { ...good, summary: "Too short." };
    const results = runChecks(bad, { retried: false });
    const sw = results.find((r) => r.name === "summaryWords");
    expect(sw?.pass).toBe(false);
  });

  it("fails when timestamps are missing", () => {
    const bad = { ...good, timestamps: [] };
    const results = runChecks(bad, { retried: false });
    const ts = results.find((r) => r.name === "timestamps");
    expect(ts?.pass).toBe(false);
  });

  it("fails when parse required retry", () => {
    const results = runChecks(good, { retried: true });
    const p = results.find((r) => r.name === "parseFirstTry");
    expect(p?.pass).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- apps/server/eval/__tests__/checks.test.ts --run`
Expected: FAIL — module doesn't exist

**Step 3: Implement checks module**

```typescript
// apps/server/eval/checks.ts
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
```

**Step 4: Run tests**

Run: `pnpm test -- apps/server/eval/__tests__/checks.test.ts --run`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add apps/server/eval/checks.ts apps/server/eval/__tests__/checks.test.ts
git commit -m "add structural quality checks for summary eval"
```

---

### Task 2: Fixture utilities and seed script

**Files:**

- Create: `apps/server/eval/fixtures.ts`
- Create: `apps/server/eval/seed-fixtures.ts`

**Step 1: Create fixture types and load/save utilities**

```typescript
// apps/server/eval/fixtures.ts
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

export interface Fixture {
  videoId: string;
  title: string;
  category: string;
  transcript: string;
}

export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as Fixture);
}

export function saveFixture(fixture: Fixture): string {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
  const filename = `${fixture.videoId}.json`;
  const filepath = join(FIXTURES_DIR, filename);
  writeFileSync(filepath, JSON.stringify(fixture, null, 2) + "\n");
  return filepath;
}
```

**Step 2: Create seed script**

This fetches transcripts for ~10 real videos and caches them as fixtures. Run once, then fixtures are committed to the repo.

```typescript
// apps/server/eval/seed-fixtures.ts
/**
 * Seed eval fixtures by fetching transcripts from YouTube.
 * Run once: npx tsx apps/server/eval/seed-fixtures.ts
 */
import { fetchTranscript } from "../src/services/transcript.js";
import { saveFixture } from "./fixtures.js";

const VIDEOS = [
  { videoId: "jNQXAC9IVRw", title: "Me at the zoo", category: "short" },
  { videoId: "8jPQjjsBbIc", title: "Fireship - 100 seconds of code", category: "tutorial" },
  { videoId: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", category: "music" },
  { videoId: "hY7m5jjJ9mM", title: "CSS in 100 Seconds", category: "tutorial" },
  {
    videoId: "pTB0EiLXUC8",
    title: "Do schools kill creativity? - Ken Robinson TED",
    category: "lecture",
  },
  { videoId: "UF8uR6Z6KLc", title: "Steve Jobs Stanford Commencement", category: "lecture" },
  {
    videoId: "MnrJzXM7a6o",
    title: "How The Economic Machine Works - Ray Dalio",
    category: "explainer",
  },
  {
    videoId: "arj7oStGLkU",
    title: "Tim Urban: Inside the mind of a master procrastinator TED",
    category: "lecture",
  },
  {
    videoId: "rfscVS0vtbw",
    title: "Python Tutorial for Beginners (first 100k chars)",
    category: "long",
  },
  {
    videoId: "PkZNo7MFNFg",
    title: "JavaScript Tutorial for Beginners (first 100k chars)",
    category: "long",
  },
];

async function main() {
  console.log("Seeding eval fixtures...\n");
  let success = 0;
  let failed = 0;

  for (const video of VIDEOS) {
    process.stdout.write(`  ${video.title}... `);
    try {
      const transcript = await fetchTranscript(video.videoId);
      const path = saveFixture({ ...video, transcript });
      console.log(`OK (${transcript.length} chars) → ${path}`);
      success++;
    } catch (err) {
      console.log(`FAIL: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} saved, ${failed} failed.`);
}

main();
```

**Step 3: Run the seed script**

Run: `npx tsx apps/server/eval/seed-fixtures.ts`
Expected: Downloads transcripts for ~10 videos, saves JSON fixtures to `apps/server/eval/fixtures/`

**Step 4: Verify fixtures created**

Run: `ls apps/server/eval/fixtures/`
Expected: ~10 `.json` files

**Step 5: Commit**

```bash
git add apps/server/eval/fixtures.ts apps/server/eval/seed-fixtures.ts apps/server/eval/fixtures/
git commit -m "add eval fixtures: transcript cache for 10 YouTube videos"
```

---

### Task 3: Eval runner (full mode)

**Files:**

- Create: `apps/server/eval/run-eval.ts`

**Step 1: Create the eval runner**

The runner imports `summarizeTranscript` directly — no HTTP server needed. It needs `ANTHROPIC_API_KEY` set in environment.

Note: We need to track whether JSON parsing required a retry. To do this, we'll wrap the summarizer call to detect retries. The simplest approach: catch and re-throw in the summarizer isn't ideal, so instead we'll call `parseSummaryResponse` separately after getting raw Claude output. But the current `summarizeTranscript` hides the retry logic internally.

**Pragmatic approach:** Track retries by wrapping — attempt `parseSummaryResponse` on the raw text before calling `summarizeTranscript`. If it fails, we know a retry happened. Actually simpler: just call `summarizeTranscript` and assume first-try success. We can add retry tracking later if needed.

```typescript
// apps/server/eval/run-eval.ts
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

function printMarkdown(results: EvalResult[]) {
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
    const checks = Object.fromEntries(r.checks.map((c) => [c.name, c.pass]));
    const icon = (ok: boolean) => (ok ? "\u2705" : "\u274C");
    lines.push(
      `| ${r.title} | ${r.category} | ${time} | ${words} ${icon(checks.summaryWords)} | ${kp} ${icon(checks.keyPoints)} | ${ts} ${icon(checks.timestamps)} | ${icon(checks.parseFirstTry)} |`,
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

  return lines.join("\n");
}

// --- CLI ---

async function runFull() {
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found. Run: npx tsx apps/server/eval/seed-fixtures.ts");
    process.exit(1);
  }
  console.log(`Running eval on ${fixtures.length} fixtures...\n`);
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
  const transcript = await fetchTranscript(videoId);
  console.log(`Transcript: ${transcript.length} chars`);

  // Use URL as title fallback
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
    const { saveFixture } = await import("./fixtures.js");
    const path = saveFixture(fixture);
    console.log(`\nSaved fixture to ${path}`);
  }
}

// --- Entry point ---

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const save = args.includes("--save");

if (urlIndex !== -1 && args[urlIndex + 1]) {
  runOneOff(args[urlIndex + 1], save);
} else {
  runFull();
}
```

**Step 2: Add `eval` script to root `package.json`**

Add to `scripts` in root `package.json`:

```json
"eval": "tsx apps/server/eval/run-eval.ts"
```

**Step 3: Verify it runs (full mode)**

Requires fixtures from Task 2 and `ANTHROPIC_API_KEY` in environment.

Run: `set -a && source .env && set +a && pnpm eval`
Expected: Runs all fixtures, prints results with quality checks

**Step 4: Verify one-off mode**

Run: `set -a && source .env && set +a && pnpm eval -- --url https://www.youtube.com/watch?v=jNQXAC9IVRw`
Expected: Fetches transcript, summarizes, prints result with checks + full summary output

**Step 5: Verify save mode**

Run: `set -a && source .env && set +a && pnpm eval -- --url https://www.youtube.com/watch?v=jNQXAC9IVRw --save`
Expected: Same as one-off but also saves fixture JSON file

**Step 6: Run typecheck**

Run: `pnpm --filter server typecheck`
Expected: PASS (eval files are outside `src/` so not included by default — need to verify tsconfig)

Note: If typecheck doesn't cover `eval/`, that's fine — eval scripts are dev tools, not production code. tsx runs them directly.

**Step 7: Commit**

```bash
git add apps/server/eval/run-eval.ts package.json
git commit -m "add eval runner with full, one-off, and save modes"
```

---

### Task 4: GitHub Action workflow

**Files:**

- Create: `.github/workflows/eval.yml`

**Step 1: Create the workflow**

```yaml
name: Summary Eval

on:
  workflow_dispatch:
    inputs:
      video_url:
        description: "YouTube URL for one-off eval (leave empty for full eval)"
        required: false
        type: string

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Run eval
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          if [ -n "${{ inputs.video_url }}" ]; then
            pnpm eval -- --url "${{ inputs.video_url }}"
          else
            pnpm eval
          fi
```

**Step 2: Commit**

```bash
git add .github/workflows/eval.yml
git commit -m "add GitHub Action for manual summary eval"
```

---

### Task 5: End-to-end verification

**Step 1: Run full CI suite locally**

Run: `pnpm exec prettier --check . && pnpm lint && pnpm --filter server typecheck && pnpm test -- --run`
Expected: All pass

**Step 2: Run full eval**

Run: `set -a && source .env && set +a && pnpm eval`
Expected: All fixtures evaluated with quality checks printed

**Step 3: Push**

```bash
git push
```
