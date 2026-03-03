import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const judgeIdx = args.indexOf("--judge");
let judgeFlag = "";

if (judgeIdx !== -1) {
  const model = args[judgeIdx + 1];
  args.splice(judgeIdx, 2);
  if (model === "opus") {
    judgeFlag = "--grader anthropic:messages:claude-opus-4-6";
  } else if (model === "sonnet") {
    judgeFlag = "--grader anthropic:messages:claude-sonnet-4-6";
  } else {
    judgeFlag = `--grader anthropic:messages:${model}`;
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
  `npx promptfoo eval -c eval/promptfooconfig.ts --env-file ../../.env ${judgeFlag} ${filterFlag} ${passthrough}`.trim();
execSync(cmd, { stdio: "inherit", cwd: `${__dirname}/..` });
