import {
  isRunnable,
  type Attachment,
  type CoachRun,
  type Direction,
  type RunBrief,
  type RunOutcome,
  type RunPicture,
  type TaskKit,
} from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { signImageUrl } from "../../lib/storage.js";
import { runFinished, runStarted } from "./botMessages.js";
import { postBotMessage } from "./chat.js";
import { loadTasks } from "./taskStore.js";

// A run is one attempt at a website change for a task, made by a runner that
// claims it over the API. The server does not know what kind of machine the
// runner is: claim, check in and finish are the whole contract.

type Row = Record<string, unknown>;

const ACTIVE = ["queued", "working"];
/** Another runner can win a claim; after this many losses in a row, try again next time. */
const CLAIM_TRIES = 3;
const MAX_TEXT = 2000;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const now = () => new Date().toISOString();

export function toRun(row: Row): CoachRun {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    status: row.status as CoachRun["status"],
    note: str(row.note),
    summary: str(row.summary),
    branch: str(row.branch),
    prUrl: str(row.pr_url),
    previewUrl: str(row.preview_url),
    pictures: (row.pictures as RunPicture[]) ?? [],
    error: str(row.error),
    createdAt: row.created_at as string,
    claimedAt: str(row.claimed_at),
    finishedAt: str(row.finished_at),
  };
}

async function projectOf(userId: string, projectId: string | null): Promise<Row | null> {
  if (!projectId) return null;
  const { data } = await supabase
    .from("coach_projects")
    .select("id, repo, site_url")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Row) ?? null;
}

/** The website repo of each of the user's projects that has one. */
export async function reposByProject(userId: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("coach_projects").select("id, repo").eq("user_id", userId);
  const repos = new Map<string, string>();
  for (const row of Array.isArray(data) ? (data as Row[]) : []) {
    const repo = str(row.repo);
    if (repo) repos.set(row.id as string, repo);
  }
  return repos;
}

/** Tell Chat how a run ended. Keyed on the run, so it is said once however often this is called. */
export async function announceFinished(userId: string, run: CoachRun): Promise<void> {
  const { data } = await supabase
    .from("coach_tasks")
    .select("id, title")
    .eq("id", run.taskId)
    .eq("user_id", userId)
    .maybeSingle();
  const task = data as { id: string; title: string } | null;
  await postBotMessage(userId, runFinished(run, task ?? { id: run.taskId, title: "" }));
}

async function runById(userId: string, runId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("coach_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Row) ?? null;
}

export type StartResult =
  | { status: 201 | 200; run: CoachRun }
  | { status: 404 | 409 | 500; error: string };

/** Queue a run for a task. Only ever called because the owner tapped a button. */
export async function startRun(userId: string, taskId: string): Promise<StartResult> {
  const { tasks } = await loadTasks(userId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { status: 404, error: "task not found" };

  const project = await projectOf(userId, task.projectId);
  if (!isRunnable(task, project ? { repo: str(project.repo) } : null)) {
    return { status: 409, error: "This task cannot be started on the site" };
  }

  const { data, error } = await supabase
    .from("coach_runs")
    .insert({ user_id: userId, task_id: taskId })
    .select("*")
    .single();
  if (data) {
    const run = toRun(data as Row);
    await postBotMessage(userId, runStarted(run, task));
    return { status: 201, run };
  }

  // The index allows one waiting or working run per task: a second tap gets that one.
  if ((error as { code?: string } | null)?.code === "23505") {
    const { data: active } = await supabase
      .from("coach_runs")
      .select("*")
      .eq("task_id", taskId)
      .eq("user_id", userId)
      .in("status", ACTIVE)
      .maybeSingle();
    if (active) return { status: 200, run: toRun(active as Row) };
  }
  return { status: 500, error: "Failed to start" };
}

/** Stop a run. The runner learns of it at its next check-in. Null when there is no such run. */
export async function cancelRun(
  userId: string,
  runId: string,
): Promise<{ run: CoachRun; changed: boolean } | null> {
  const { data } = await supabase
    .from("coach_runs")
    .update({ status: "cancelled", finished_at: now() })
    .eq("id", runId)
    .eq("user_id", userId)
    .in("status", ACTIVE)
    .select("*")
    .maybeSingle();
  if (data) {
    const run = toRun(data as Row);
    await announceFinished(userId, run);
    return { run, changed: true };
  }
  const existing = await runById(userId, runId);
  return existing ? { run: toRun(existing), changed: false } : null;
}

async function briefFor(userId: string, run: Row): Promise<RunBrief | null> {
  const { data: taskData } = await supabase
    .from("coach_tasks")
    .select("*")
    .eq("id", run.task_id as string)
    .eq("user_id", userId)
    .maybeSingle();
  const task = taskData as Row | null;
  const project = task ? await projectOf(userId, str(task.project_id)) : null;
  const repo = str(project?.repo);
  if (!task || !repo) return null;

  let request: Row | null = null;
  if (task.request_id) {
    const { data } = await supabase
      .from("coach_requests")
      .select("id, bundle_id, understood, answer")
      .eq("id", task.request_id as string)
      .eq("user_id", userId)
      .maybeSingle();
    request = (data as Row) ?? null;
  }

  let messages: RunBrief["messages"] = [];
  if (request?.bundle_id) {
    const { data } = await supabase
      .from("coach_messages")
      .select("direction, text, sent_at, attachments")
      .eq("bundle_id", request.bundle_id as string)
      .eq("user_id", userId)
      .order("sent_at", { ascending: true });
    messages = await Promise.all(
      ((data as Row[]) ?? []).map(async (m) => {
        const urls = await Promise.all(
          ((m.attachments as Attachment[]) ?? []).map((a) => signImageUrl(a.storagePath)),
        );
        return {
          direction: m.direction as Direction,
          text: (m.text as string) ?? "",
          sentAt: m.sent_at as string,
          imageUrls: urls.filter((u): u is string => Boolean(u)),
        };
      }),
    );
  }

  return {
    runId: run.id as string,
    repo,
    siteUrl: str(project?.site_url),
    understood: (request?.understood as string) ?? "",
    answer: str(request?.answer),
    task: { title: task.title as string, kit: (task.kit as TaskKit) ?? {} },
    messages,
  };
}

/** Hand the oldest queued run to this caller, and to no one else. Null when nothing is queued. */
export async function claimRun(userId: string): Promise<{ run: CoachRun; brief: RunBrief } | null> {
  for (let attempt = 0; attempt < CLAIM_TRIES; attempt += 1) {
    const { data: next } = await supabase
      .from("coach_runs")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!next) return null;

    // Guarded on "still queued": of two runners asking at once, one gets the row.
    const { data: claimed } = await supabase
      .from("coach_runs")
      .update({ status: "working", claimed_at: now(), seen_at: now() })
      .eq("id", (next as Row).id as string)
      .eq("user_id", userId)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (!claimed) continue;

    const brief = await briefFor(userId, claimed as Row);
    if (brief) return { run: toRun(claimed as Row), brief };
    // The task or its repo went away after the tap: nothing a runner could do.
    await finishRun(userId, (claimed as Row).id as string, {
      status: "failed",
      error: "The project no longer has a website repo.",
    });
  }
  return null;
}

/**
 * "Still working." Answers whether the runner should stop: the run was
 * cancelled, or is no longer working for any other reason.
 */
export async function checkInRun(
  userId: string,
  runId: string,
  note: string | null,
): Promise<{ cancelled: boolean } | null> {
  const { data } = await supabase
    .from("coach_runs")
    .update({ seen_at: now(), note })
    .eq("id", runId)
    .eq("user_id", userId)
    .eq("status", "working")
    .select("id")
    .maybeSingle();
  if (data) return { cancelled: false };
  return (await runById(userId, runId)) ? { cancelled: true } : null;
}

const cut = (v: string | undefined): string | null => (v ? v.slice(0, MAX_TEXT) : null);

/**
 * Store a run's outcome. Only a run that is still going can be finished: a
 * repeat, or a finish after Stop, changes nothing and reports what is stored.
 */
export async function finishRun(
  userId: string,
  runId: string,
  outcome: RunOutcome,
): Promise<{ run: CoachRun; changed: boolean } | null> {
  const { data } = await supabase
    .from("coach_runs")
    .update({
      status: outcome.status,
      summary: cut(outcome.summary),
      branch: outcome.branch ?? null,
      pr_url: outcome.prUrl ?? null,
      preview_url: outcome.previewUrl ?? null,
      pictures: outcome.pictures ?? [],
      error: cut(outcome.error),
      finished_at: now(),
    })
    .eq("id", runId)
    .eq("user_id", userId)
    .in("status", ACTIVE)
    .select("*")
    .maybeSingle();
  if (data) {
    const run = toRun(data as Row);
    await announceFinished(userId, run);
    return { run, changed: true };
  }
  const existing = await runById(userId, runId);
  return existing ? { run: toRun(existing), changed: false } : null;
}

/** The newest run for a task, with addresses for its pictures. */
export async function latestRun(userId: string, taskId: string): Promise<CoachRun | null> {
  const { data } = await supabase
    .from("coach_runs")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const run = toRun(data as Row);
  const pictures = await Promise.all(
    run.pictures.map(async (p) => ({
      ...p,
      url: (await signImageUrl(p.storagePath)) ?? undefined,
    })),
  );
  return { ...run, pictures };
}
