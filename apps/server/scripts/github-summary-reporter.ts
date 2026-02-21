import { appendFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";

/**
 * Vitest reporter that writes a markdown summary to $GITHUB_STEP_SUMMARY.
 * Silently skips if the env var isn't set (local runs).
 */
export default class GithubSummaryReporter implements Reporter {
  private results: { name: string; passed: boolean; duration: number }[] = [];

  onTestCaseResult(testCase: TestCase) {
    this.results.push({
      name: testCase.name,
      passed: testCase.result().state === "passed",
      duration: testCase.diagnostic()?.duration ?? 0,
    });
  }

  onTestRunEnd() {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;

    const apiBase = process.env.API_BASE_URL ?? "https://cliphy.vercel.app";
    const passed = this.results.filter((t) => t.passed).length;

    const lines = [
      `## API Smoke Test`,
      ``,
      `**${passed}/${this.results.length} passed** against \`${apiBase}\``,
      ``,
      `| Test | Result | Duration |`,
      `|------|--------|----------|`,
      ...this.results.map(
        (t) => `| ${t.name} | ${t.passed ? "PASS" : "FAIL"} | ${Math.round(t.duration)}ms |`,
      ),
    ];

    appendFileSync(summaryPath, lines.join("\n") + "\n");
  }
}
