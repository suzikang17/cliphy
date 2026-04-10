import { copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReportFromFile, generateIndex } from "./report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(__dirname, "results");

// Timestamped filename: 2026-03-03_21-45.json
const now = new Date();
const stamp = [
  now.getFullYear(),
  "-",
  String(now.getMonth() + 1).padStart(2, "0"),
  "-",
  String(now.getDate()).padStart(2, "0"),
  "_",
  String(now.getHours()).padStart(2, "0"),
  "-",
  String(now.getMinutes()).padStart(2, "0"),
].join("");
const resultsJson = resolve(resultsDir, `${stamp}.json`);

const args = process.argv.slice(2);
const judgeIdx = args.indexOf("--judge");
let judgeModel = "";

if (judgeIdx !== -1) {
  const model = args[judgeIdx + 1];
  args.splice(judgeIdx, 2);
  if (model === "opus") {
    judgeModel = "anthropic:messages:claude-opus-4-6";
  } else if (model === "sonnet") {
    judgeModel = "anthropic:messages:claude-sonnet-4-6";
  } else {
    judgeModel = `anthropic:messages:${model}`;
  }
}

const categoryIdx = args.indexOf("--category");
let filterFlag = "";
if (categoryIdx !== -1) {
  const category = args[categoryIdx + 1];
  args.splice(categoryIdx, 2);
  filterFlag = `--filter-pattern "\\[${category}\\]"`;
}

const passthrough = args.join(" ");
const cmd =
  `npx promptfoo eval -c eval/promptfooconfig.ts --env-file ../../.env -o ${resultsJson} ${filterFlag} ${passthrough}`.trim();

// Set judge model via env var (--grader CLI flag causes Promptfoo serialization bug)
const env = { ...process.env };
if (judgeModel) {
  env.EVAL_JUDGE_MODEL = judgeModel;
}

try {
  execSync(cmd, { stdio: "inherit", cwd: `${__dirname}/..`, env });
} catch {
  // Promptfoo exits non-zero when tests fail — that's expected
}

// Copy to latest.json for convenience
const latestJson = resolve(resultsDir, "latest.json");
copyFileSync(resultsJson, latestJson);

// Generate individual HTML report + index
const htmlPath = generateReportFromFile(resultsJson);
generateReportFromFile(latestJson);
const indexPath = generateIndex(resultsDir);

console.log(`\nReport: ${htmlPath}`);
console.log(`Index:  ${indexPath}`);
