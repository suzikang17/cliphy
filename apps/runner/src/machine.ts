import { spawn, type ChildProcess } from "node:child_process";
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
// configuration, by the runner's user. Neither user can read the other's
// folders except for that one copy back, which carries file contents only:
// no owners, no special permission bits, no devices.

export interface RunnerConfig {
  apiUrl: string;
  apiKey: string;
  /** The user Claude Code and build commands run as. Holds no credentials. */
  workUser: string;
  /** Where the work user's copies live. Owned by the work user, readable by the runner. */
  workRoot: string;
  /** The runner's own clones. Owned by the runner and closed to everyone else. */
  reposRoot: string;
  /** The work user's home, cleared of leftovers between runs. Default `/home/<workUser>`. */
  workHome?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (
  cmd: string,
  args: string[],
  opts?: {
    cwd?: string;
    timeoutMs?: number;
    /** Feed this program's output straight into another program's input. */
    pipeTo?: [string, string[]];
  },
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
    const next = opts.pipeTo
      ? spawn(opts.pipeTo[0], opts.pipeTo[1], { stdio: ["pipe", "pipe", "pipe"] })
      : null;
    let stdout = "";
    let stderr = "";
    const codes: number[] = [];
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          next?.kill("SIGTERM");
        }, opts.timeoutMs)
      : null;
    const ended = (code: number) => {
      codes.push(code);
      if (codes.length < (next ? 2 : 1)) return;
      if (timer) clearTimeout(timer);
      // A pipe worked only if both ends did.
      resolve({ code: codes.find((c) => c !== 0) ?? 0, stdout, stderr });
    };
    const watch = (proc: ChildProcess) => {
      proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("error", (err) => {
        stderr += String(err);
        ended(127);
      });
      proc.on("close", (code) => ended(code ?? 1));
    };
    watch(child);
    if (next) {
      watch(next);
      next.stdin.on("error", () => {});
      child.stdout.pipe(next.stdin);
      next.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    } else {
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    }
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
    // No settings files at all: a client's repo cannot bring its own permissions or hooks,
    // and neither can anything an earlier run left in the work user's home.
    "--setting-sources",
    "",
  ];
}

const asWork = (config: RunnerConfig, cmd: string, args: string[]): [string, string[]] => [
  "sudo",
  ["-n", "-u", config.workUser, "-H", cmd, ...args],
];

/**
 * Claude Code as the work user, in a session of its own, under a clock. The
 * runner cannot signal another user's process, so the time limit is enforced
 * by `timeout` running as the work user itself (exit code 124 when it fires).
 */
export function claudeCommand(config: RunnerConfig, limitMs: number): [string, string[]] {
  const seconds = String(Math.ceil(limitMs / 1000));
  return asWork(config, "setsid", [
    "--wait",
    "timeout",
    "-k",
    "10",
    seconds,
    "claude",
    ...claudeArgs(),
  ]);
}

/** Things in the work user's home that would steer a later run, for any client. */
const LEFTOVERS = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/CLAUDE.md",
  ".npmrc",
  ".yarnrc.yml",
  ".config/pnpm/rc",
];
const BRIEF_DIR = ".cliphy-brief";
const MAX_IMAGES = 6;

/** A failure to publish. `pushed` says the branch is on GitHub even so. */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly pushed: boolean,
  ) {
    super(message);
  }
}

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
  const home = config.workHome ?? path.join("/home", config.workUser);
  /**
   * Stop everything the work user is running. Nothing of one run may outlive
   * it: not a build script's background process, not a Claude that ignored its
   * clock. (pkill exits 1 when there was nothing to stop.)
   */
  const stopWork = async () => {
    await exec(...asWork(config, "pkill", ["-KILL", "-u", config.workUser]));
  };

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

      // Nothing from an earlier run, for this client or another, carries over.
      await stopWork();
      await exec(...asWork(config, "crontab", ["-r"]));
      await must(
        ...asWork(config, "rm", ["-rf", work, ...LEFTOVERS.map((f) => path.join(home, f))]),
      );
      await must(...asWork(config, "mkdir", ["-p", work]));
      // Claude's copy: plain files, no history. The runner reads its own clone and
      // the work user unpacks, so neither needs to see into the other's folders.
      const copied = await exec("tar", ["-C", clone, "--exclude=./.git", "-cf", "-", "."], {
        timeoutMs: 5 * 60_000,
        pipeTo: asWork(config, "tar", ["-x", "-C", work]),
      });
      if (copied.code !== 0)
        throw new Error(`copy to the work folder failed: ${copied.stderr.slice(0, 300)}`);
      return { workDir: work };
    },

    async attach(repo, urls) {
      const { work } = check(repo);
      const dir = path.join(work, BRIEF_DIR);
      const files: string[] = [];
      const wanted = urls.filter((u) => /^https:\/\/[^\s]+$/.test(u)).slice(0, MAX_IMAGES);
      if (wanted.length === 0) return files;
      await must(...asWork(config, "mkdir", ["-p", dir]));
      for (const [i, url] of wanted.entries()) {
        const ext = /\.(png|jpe?g|webp|gif)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";
        const name = `${i + 1}.${ext}`;
        // Fetched by the work user: the address is a short-lived one for this picture only.
        const got = await exec(
          ...asWork(config, "curl", [
            "-fsS",
            "--proto",
            "=https",
            "--max-time",
            "30",
            "--max-filesize",
            "20000000",
            "-o",
            path.join(dir, name),
            "--",
            url,
          ]),
          { timeoutMs: 45_000 },
        );
        if (got.code === 0) files.push(`${BRIEF_DIR}/${name}`);
      }
      return files;
    },

    async collect(repo) {
      const { clone, work } = check(repo);
      // Nothing may still be changing the folder while it is read.
      await stopWork();
      // File contents only. Not `-a`: that would carry owners, setuid bits and
      // device files into a folder the runner owns. No git data, no
      // dependencies, no link that points out of the folder.
      await must("rsync", [
        "-rlt",
        "--executability",
        "--chmod=ug-s,o-w",
        "--delete",
        "--safe-links",
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        "--exclude",
        BRIEF_DIR,
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
        // The branch is up even though the pull request is not: the work is not lost.
        throw new PublishError(`gh pr create failed: ${result.stderr.slice(0, 300)}`, true);
      }
      return { prUrl };
    },

    async discard(repo) {
      const { work } = check(repo);
      await must(...asWork(config, "rm", ["-rf", work]));
      await stopWork();
    },
  };
}

/** How often a waiting step asks whether the run was stopped (which is also its check-in). */
const ALIVE_EVERY_MS = 60_000;
/** `timeout` exits with this when the clock ran out. */
const TIMED_OUT = 124;

/** Start Claude Code as the work user in `workDir`, with the prompt on standard input. */
export function runClaude(
  config: RunnerConfig,
  workDir: string,
  prompt: string,
  limitMs: number,
  alive: Alive,
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const [cmd, args] = claudeCommand(config, limitMs);
    const child = spawn(cmd, args, { cwd: workDir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let ended = false;
    /** The runner cannot signal the work user's processes itself; the work user's own pkill can. */
    const stopWork = () =>
      void realExec(...asWork(config, "pkill", ["-KILL", "-u", config.workUser]));
    const end = (result: ClaudeResult, kill: boolean) => {
      if (ended) return;
      ended = true;
      clearTimeout(backstop);
      clearInterval(pulse);
      if (kill) stopWork();
      resolve(result);
    };
    // `timeout` is the clock. This is only for the case where it never reports back.
    const backstop = setTimeout(
      () => end({ ok: false, reason: "timeout", detail: "" }, true),
      limitMs + 30_000,
    );
    const pulse = setInterval(() => {
      // A check-in that could not be made is not a Stop: keep working.
      alive().then(
        (ok) => {
          if (!ok) end({ ok: false, reason: "stopped", detail: "" }, true);
        },
        () => {},
      );
    }, ALIVE_EVERY_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => end({ ok: false, reason: "error", detail: String(err) }, true));
    child.on("close", (code) => {
      if (code === 0) return end({ ok: true, stdout }, false);
      if (code === TIMED_OUT || code === 137) {
        return end({ ok: false, reason: "timeout", detail: "" }, true);
      }
      end({ ok: false, reason: "error", detail: `exit ${code}: ${stderr.slice(-500)}` }, true);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
