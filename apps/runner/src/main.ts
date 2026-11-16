import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createApi } from "./api.js";
import { createRepo, realExec, runClaude, type RunnerConfig } from "./machine.js";
import { findPreview } from "./preview.js";
import { runOnce, type RunDeps } from "./run.js";

// cliphy runner: claims website changes from the coach, makes them with
// Claude Code as a second user, and opens a pull request. See README.md and
// docs/runner-setup.md.

const IDLE_MS = 20_000;
const CONFIG_PATH = path.join(homedir(), ".cliphy-runner", "config.json");
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function loadConfig(): RunnerConfig | null {
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<RunnerConfig>;
    if (!c.apiUrl || !c.apiKey || !c.workUser || !c.workRoot || !c.reposRoot) return null;
    return c as RunnerConfig;
  } catch {
    return null;
  }
}

/** The first screen of a page, as a visitor with that size of window sees it. */
async function shoot(url: string, width: "phone" | "desktop"): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: SIZES[width] });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

function deps(config: RunnerConfig): RunDeps {
  return {
    api: createApi(config),
    repo: createRepo(config, realExec),
    claude: (workDir, prompt, limitMs, alive) => runClaude(config, workDir, prompt, limitMs, alive),
    preview: (repo, branch, limitMs, alive) => findPreview(realExec, repo, branch, limitMs, alive),
    shoot,
    log,
  };
}

/** Each thing the runner needs, with what to do when it is missing. */
async function check(): Promise<boolean> {
  const results: [boolean, string, string][] = [];
  const add = (ok: boolean, what: string, fix: string) => results.push([ok, what, fix]);
  const ran = async (cmd: string, args: string[]) => (await realExec(cmd, args)).code === 0;

  const config = loadConfig();
  add(config !== null, `Config at ${CONFIG_PATH}`, "Create it: see docs/runner-setup.md, step 8.");
  if (config) {
    const mode = statSync(CONFIG_PATH).mode & 0o777;
    add((mode & 0o077) === 0, "Config readable only by this user", `chmod 600 ${CONFIG_PATH}`);
    const sudo = ["-n", "-u", config.workUser, "-H"];
    add(await ran("gh", ["auth", "status"]), "GitHub login for this user", "gh auth login");
    add(
      await ran("sudo", [...sudo, "true"]),
      `Can run commands as ${config.workUser}`,
      "Add the sudoers line: docs/runner-setup.md, step 2.",
    );
    add(
      await ran("sudo", [...sudo, "claude", "--version"]),
      `${config.workUser} can run Claude Code`,
      `Install claude for ${config.workUser} and log it in.`,
    );
    add(
      !(await ran("sudo", [...sudo, "cat", CONFIG_PATH])),
      `${config.workUser} cannot read this user's config`,
      `chmod 700 ${homedir()}`,
    );
    add(await ran("sudo", [...sudo, "rsync", "--version"]), "rsync installed", "Install rsync.");
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      await browser.close();
      add(true, "Browser for pictures", "");
    } catch {
      add(
        false,
        "Browser for pictures",
        "pnpm --filter cliphy-runner exec playwright install chromium",
      );
    }
    try {
      await createApi(config).checkIn("00000000-0000-4000-8000-000000000000", "check");
      add(true, "Cliphy API answers this key", "");
    } catch (err) {
      // A 404 for a made-up run means the key was accepted.
      add(String(err).includes("→ 404"), "Cliphy API answers this key", "Check apiUrl and apiKey.");
    }
  }
  for (const [ok, what, fix] of results)
    console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `\n     ${fix}`}`);
  return results.every(([ok]) => ok);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";
  if (command === "check") {
    process.exit((await check()) ? 0 : 1);
  }
  const config = loadConfig();
  if (!config) {
    console.error(`No usable config at ${CONFIG_PATH}. See docs/runner-setup.md.`);
    process.exit(1);
  }
  const d = deps(config);
  if (command === "once") {
    log(`One cycle: ${await runOnce(d)}`);
    return;
  }
  if (command !== "run") {
    console.error("Usage: cliphy-runner run | once | check");
    process.exit(1);
  }
  log("Runner started.");
  for (;;) {
    let result = "idle";
    try {
      result = await runOnce(d);
    } catch (err) {
      log(`Cycle failed: ${String(err)}`);
    }
    // Straight on to the next run after one; otherwise wait a little.
    if (result === "idle") await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
}

void main();
