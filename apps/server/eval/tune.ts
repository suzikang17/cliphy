import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReportFromFile } from "./report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsJson = resolve(__dirname, "results/latest.json");

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

// Generate HTML report from the JSON output
const htmlPath = generateReportFromFile(resultsJson);
console.log(`\nReport: ${htmlPath}`);
