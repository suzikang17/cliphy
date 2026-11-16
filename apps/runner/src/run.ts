import { branchName } from "./branch.js";
import type { RunBrief, RunOutcome, RunPicture } from "./contract.js";
import { buildPrompt, parseResult } from "./prompt.js";

// One run, start to finish. Everything that touches the machine or the
// network is passed in, so the order of steps and every way of failing are
// decided here and tested on any machine.

export const CLAUDE_LIMIT_MS = 20 * 60_000;
export const PREVIEW_LIMIT_MS = 10 * 60_000;

/** Asked while a long step waits: false means the run was stopped and the step should give up. */
export type Alive = () => Promise<boolean>;

export type ClaudeResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: "timeout" | "error" | "stopped"; detail: string };

export interface RunDeps {
  api: {
    claim(): Promise<{ run: { id: string }; brief: RunBrief } | null>;
    checkIn(runId: string, note: string): Promise<{ cancelled: boolean }>;
    finish(runId: string, outcome: RunOutcome): Promise<void>;
    /** Store a picture; returns its stored path. */
    upload(bytes: Buffer, mediaType: "image/png"): Promise<string>;
  };
  repo: {
    /** A fresh copy of the repo's default branch for Claude to work in, on a new branch. */
    prepare(repo: string, branch: string): Promise<{ workDir: string }>;
    /** Bring Claude's changes back; says whether there are any. */
    collect(repo: string): Promise<{ changed: boolean }>;
    /** Commit, push the branch and open the pull request. */
    publish(repo: string, branch: string, title: string, body: string): Promise<{ prUrl: string }>;
    discard(repo: string): Promise<void>;
  };
  claude(workDir: string, prompt: string, limitMs: number, alive: Alive): Promise<ClaudeResult>;
  /** The preview address for the branch, or null when none appears in time. */
  preview(repo: string, branch: string, limitMs: number, alive: Alive): Promise<string | null>;
  shoot(url: string, width: "phone" | "desktop"): Promise<Buffer>;
  log(line: string): void;
}

export type RunResult = "idle" | "done" | "failed" | "cancelled";

const PR_NOTE = "Made by the Cliphy runner for a request the owner confirmed.";
const WIDTHS = ["phone", "desktop"] as const;

const join = (base: string, path: string): string => `${base.replace(/\/+$/, "")}${path}`;

export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const claimed = await deps.api.claim();
  if (!claimed) return "idle";
  const { run, brief } = claimed;
  deps.log(`Run ${run.id}: ${brief.task.title}`);

  const fail = async (error: string, extra: Partial<RunOutcome> = {}): Promise<RunResult> => {
    deps.log(`Run ${run.id} failed: ${error}`);
    await deps.api.finish(run.id, { status: "failed", error, ...extra });
    return "failed";
  };
  /** True when the owner stopped the run. A check-in that cannot be made is not a stop. */
  const stopped = async (note: string): Promise<boolean> =>
    (await deps.api.checkIn(run.id, note)).cancelled;

  try {
    return await work(deps, run.id, brief, fail, stopped);
  } catch (err) {
    deps.log(`Run ${run.id} broke: ${String(err)}`);
    return await fail("Something went wrong on the runner.").catch(() => "failed" as const);
  } finally {
    await deps.repo.discard(brief.repo).catch((err) => deps.log(`Could not clear up: ${err}`));
  }
}

async function work(
  deps: RunDeps,
  runId: string,
  brief: RunBrief,
  fail: (error: string, extra?: Partial<RunOutcome>) => Promise<RunResult>,
  stopped: (note: string) => Promise<boolean>,
): Promise<RunResult> {
  const branch = branchName(runId, brief.task.title);

  let workDir: string;
  try {
    ({ workDir } = await deps.repo.prepare(brief.repo, branch));
  } catch (err) {
    deps.log(`Prepare failed: ${String(err)}`);
    return fail("Could not get the website's code.");
  }

  const result = await deps.claude(
    workDir,
    buildPrompt(brief),
    CLAUDE_LIMIT_MS,
    async () => !(await stopped("working on it")),
  );
  if (!result.ok) {
    if (result.reason === "stopped") return "cancelled";
    if (result.reason === "timeout") return fail("It took longer than 20 minutes.");
    deps.log(`Claude failed: ${result.detail}`);
    return fail("Claude Code could not do the work.");
  }
  // Nothing is published on the strength of files alone: Claude has to say what it did.
  const answer = parseResult(result.stdout);
  if (!answer) return fail("Claude did not say what it changed.");

  const { changed } = await deps.repo.collect(brief.repo);
  if (!changed) return fail(answer.summary);

  if (await stopped("opening the pull request")) return "cancelled";
  let prUrl: string;
  try {
    // The summary and a fixed line. Never the client's messages.
    const body = `${answer.summary}\n\n${PR_NOTE}`;
    ({ prUrl } = await deps.repo.publish(brief.repo, branch, brief.task.title, body));
  } catch (err) {
    deps.log(`Publish failed: ${String(err)}`);
    return fail("Could not open the pull request.");
  }

  const previewUrl = await deps.preview(
    brief.repo,
    branch,
    PREVIEW_LIMIT_MS,
    async () => !(await stopped("waiting for the preview")),
  );
  if (await stopped(previewUrl ? "taking pictures" : "finishing")) return "cancelled";

  const pictures: RunPicture[] = [];
  if (previewUrl) {
    // Before and after are the same page, so the two are a real comparison.
    const path = answer.paths[0] ?? "/";
    const pages: [RunPicture["label"], string][] = [["after", join(previewUrl, path)]];
    if (brief.siteUrl) pages.push(["before", join(brief.siteUrl, path)]);
    for (const [label, url] of pages) {
      for (const width of WIDTHS) {
        try {
          const storagePath = await deps.api.upload(await deps.shoot(url, width), "image/png");
          pictures.push({ label, width, storagePath });
        } catch (err) {
          deps.log(`No ${label} picture at ${width} width: ${String(err)}`);
        }
      }
    }
  }

  await deps.api.finish(runId, {
    status: "done",
    summary: answer.summary,
    branch,
    prUrl,
    ...(previewUrl ? { previewUrl } : {}),
    pictures,
  });
  deps.log(`Run ${runId} done: ${prUrl}`);
  return "done";
}
