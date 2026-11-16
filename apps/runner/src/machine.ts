import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_PATTERN } from "./contract.js";
import { RESULT_SCHEMA } from "./prompt.js";
import type { Alive, ClaudeResult, RunDeps } from "./run.js";

// The runner's hands: git, GitHub and Claude Code on this machine.
//
// Two users keep a client's text and a client's code away from the
// credentials. The runner's own user holds the GitHub login and the Cliphy
// key, and is the only one that runs git or gh. Claude Code and every build
// command run as the work user, in a copy of the code that has no `.git`.
// The runner then copies plain files back into its own clone and commits
// with hooks off, so nothing the work user can write is ever run, or read as
// configuration, by the runner's user.

export interface RunnerConfig {
  apiUrl: string;
  apiKey: string;
  /** The user Claude Code and build commands run as. Holds no credentials. */
  workUser: string;
  /** Where the work user's copies live. Owned by the work user, readable by the runner. */
  workRoot: string;
  /** The runner's own clones. Owned by the runner, readable (not writable) by the work user. */
  reposRoot: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<ExecResult>;

const BRANCH_PATTERN = /^cliphy\/[a-z0-9-]+$/;
/** Git never runs a hook or a file-watcher program, whatever a repo's files say. */
const SAFE_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
const INSTALLERS = ["pnpm", "npm", "yarn", "bun", "npx", "node"];
/** Reading and changing files is allowed inside the folder Claude is started in, and nowhere else. */
const HERE = ["Read(./**)", "Edit(./**)", "Write(./**)"];

/** Run a program with its arguments as given: no shell ever reads them. */
export const realExec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs) : null;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const done = (code: number) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.on("error", (err) => {
      stderr += String(err);
      done(127);
    });
    child.on("close", (code) => done(code ?? 1));
  });

/**
 * The arguments Claude Code is started with. The prompt is not among them: it
 * goes in on standard input, so no word from a client is on a command line.
 */
export function claudeArgs(): string[] {
  const files = ["Read", "Edit", "Write", "Glob", "Grep"];
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(RESULT_SCHEMA),
    // Anything not allowed below is refused without asking: there is nobody to ask.
    "--permission-mode",
    "dontAsk",
    "--tools",
    [...files, "Bash"].join(","),
    "--allowedTools",
    [...HERE, "Glob", "Grep", ...INSTALLERS.map((p) => `Bash(${p} *)`)].join(","),
    "--disallowedTools",
    [
      "WebFetch",
      "WebSearch",
      "Bash(git push *)",
      "Bash(gh *)",
      "Bash(curl *)",
      "Bash(wget *)",
    ].join(","),
    // The user's own settings only: a client's repo cannot bring its own permissions or hooks.
    "--setting-sources",
    "user",
  ];
}

const asWork = (config: RunnerConfig, cmd: string, args: string[]): [string, string[]] => [
  "sudo",
  ["-n", "-u", config.workUser, "-H", cmd, ...args],
];

export function createRepo(config: RunnerConfig, exec: Exec): RunDeps["repo"] {
  const check = (repo: string, branch?: string) => {
    if (!REPO_PATTERN.test(repo) || repo.includes("..")) throw new Error("Not a repo name");
    if (branch !== undefined && !BRANCH_PATTERN.test(branch)) {
      throw new Error("The runner only works on cliphy/ branches");
    }
    const slug = repo.replace("/", "__");
    return { clone: path.join(config.reposRoot, slug), work: path.join(config.workRoot, slug) };
  };
  /** Run, and stop the run if it fails. */
  const must = async (cmd: string, args: string[]): Promise<string> => {
    const result = await exec(cmd, args, { timeoutMs: 5 * 60_000 });
    if (result.code !== 0) {
      // Name the step without the `-c` settings in front of it.
      const step = args.filter((a) => a !== "-c" && !a.startsWith("core.")).slice(0, 6);
      throw new Error(`${cmd} ${step.join(" ")} failed: ${result.stderr.slice(0, 300)}`);
    }
    return result.stdout;
  };
  const git = (clone: string, ...args: string[]) =>
    must("git", [...SAFE_GIT, "-C", clone, ...args]);

  return {
    async prepare(repo, branch) {
      const { clone, work } = check(repo, branch);
      const have = await exec("git", ["-C", clone, "rev-parse", "--git-dir"]);
      if (have.code !== 0) await must("gh", ["repo", "clone", repo, clone]);
      await git(clone, "fetch", "origin", "--prune");
      const head = (await git(clone, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")).trim();
      if (!/^origin\/[\w./-]+$/.test(head)) throw new Error("No default branch");
      await git(clone, "checkout", "-f", "-B", branch, head);
      await git(clone, "clean", "-fdx");

      // Claude's copy: plain files, no history, made and owned by the work user.
      await must(...asWork(config, "rm", ["-rf", work]));
      await must(...asWork(config, "mkdir", ["-p", work]));
      await must(
        ...asWork(config, "rsync", [
          "-a",
          "--delete",
          "--exclude",
          ".git",
          `${clone}/`,
          `${work}/`,
        ]),
      );
      return { workDir: work };
    },

    async collect(repo) {
      const { clone, work } = check(repo);
      // Files only. No git data, no dependencies, and no link that points out of the folder.
      await must("rsync", [
        "-a",
        "--delete",
        "--no-owner",
        "--no-group",
        "--safe-links",
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        `${work}/`,
        `${clone}/`,
      ]);
      await git(clone, "add", "-A");
      return { changed: (await git(clone, "status", "--porcelain")).trim() !== "" };
    },

    async publish(repo, branch, title, body) {
      const { clone } = check(repo, branch);
      await git(clone, "commit", "-m", title);
      // Only ever this run's own branch. Nothing reaches a default branch.
      await git(clone, "push", "origin", `HEAD:refs/heads/${branch}`);

      const create = [
        "pr",
        "create",
        "--repo",
        repo,
        "--head",
        branch,
        "--title",
        title,
        "--body",
        body,
      ];
      let result = await exec("gh", [...create, "--draft"], { timeoutMs: 60_000 });
      if (result.code !== 0 && /draft pull requests are not supported/i.test(result.stderr)) {
        result = await exec("gh", create, { timeoutMs: 60_000 });
      }
      const prUrl = result.stdout.trim().split("\n").pop() ?? "";
      if (result.code !== 0 || !/^https:\/\/github\.com\/\S+\/pull\/\d+$/.test(prUrl)) {
        throw new Error(`gh pr create failed: ${result.stderr.slice(0, 300)}`);
      }
      return { prUrl };
    },

    async discard(repo) {
      const { work } = check(repo);
      await must(...asWork(config, "rm", ["-rf", work]));
    },
  };
}

/** How often a waiting step asks whether the run was stopped (which is also its check-in). */
const ALIVE_EVERY_MS = 60_000;

/** Start Claude Code as the work user in `workDir`, with the prompt on standard input. */
export function runClaude(
  config: RunnerConfig,
  workDir: string,
  prompt: string,
  limitMs: number,
  alive: Alive,
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const [cmd, args] = asWork(config, "claude", claudeArgs());
    const child = spawn(cmd, args, { cwd: workDir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let ended: ClaudeResult | null = null;
    const end = (result: ClaudeResult) => {
      if (ended) return;
      ended = result;
      clearTimeout(limit);
      clearInterval(pulse);
      child.kill("SIGTERM");
      resolve(result);
    };
    const limit = setTimeout(() => end({ ok: false, reason: "timeout", detail: "" }), limitMs);
    const pulse = setInterval(() => {
      // A check-in that could not be made is not a Stop: keep working.
      alive().then(
        (ok) => {
          if (!ok) end({ ok: false, reason: "stopped", detail: "" });
        },
        () => {},
      );
    }, ALIVE_EVERY_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => end({ ok: false, reason: "error", detail: String(err) }));
    child.on("close", (code) =>
      end(
        code === 0
          ? { ok: true, stdout }
          : { ok: false, reason: "error", detail: `exit ${code}: ${stderr.slice(-500)}` },
      ),
    );
    child.stdin.end(prompt);
  });
}
