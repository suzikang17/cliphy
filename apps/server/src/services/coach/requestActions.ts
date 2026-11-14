import { randomUUID } from "node:crypto";
import type { CoachRequest, CoachTask } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { inngest } from "../../lib/inngest.js";
import { toRequest, toTask } from "../../lib/coachMappers.js";
import { isBlocked, materializeChain } from "./chain.js";
import { syncTaskReminders } from "./reminders.js";

// What can be done to a request. Used by the HTTP routes, by chat buttons and
// by the chat agent, so all three behave identically.

type Row = Record<string, unknown>;

export async function loadRequest(id: string, userId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("coach_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Task rows → API tasks, with `blocked` computed within the set. */
export function withBlocked(rows: Row[]): CoachTask[] {
  const byId = new Map(rows.map((r) => [r.id as string, { state: r.state as CoachTask["state"] }]));
  return rows.map((r) =>
    toTask(r, isBlocked({ afterTaskId: (r.after_task_id as string) ?? null }, byId)),
  );
}

export async function tasksOfRequest(requestId: string, userId: string): Promise<CoachTask[]> {
  const { data } = await supabase
    .from("coach_tasks")
    .select("*")
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  return withBlocked((data as Row[]) ?? []);
}

/** A confirm that flipped the status but never got its tasks is repairable after this long. */
const REPAIR_AFTER_MS = 60_000;

/**
 * Create a confirmed request's task chain in one statement, so it exists
 * entirely or not at all. Ids are made here so tasks can point at each other.
 */
async function createChain(
  request: CoachRequest,
  userId: string,
): Promise<{ rows: Row[] } | { error: true }> {
  const chain = materializeChain(request.proposedTasks, { answered: request.answer !== null });
  if (chain.length === 0) return { rows: [] };

  const ids = chain.map(() => randomUUID());
  const firstDo = chain.findIndex((t) => t.kind === "do");
  // The deadline belongs on the work; with no `do` task it goes on the first step.
  const dated = firstDo === -1 ? 0 : firstDo;

  const { data, error } = await supabase
    .from("coach_tasks")
    .insert(
      chain.map((task, i) => ({
        id: ids[i],
        user_id: userId,
        request_id: request.id,
        project_id: request.projectId,
        kind: task.kind,
        title: task.title,
        kit: task.kit,
        with_person_id: task.withPerson ? request.personId : null,
        after_task_id: task.afterIndex !== null ? ids[task.afterIndex] : null,
        due_date: i === dated ? request.dueDate : null,
        position: task.position,
      })),
    )
    .select("*");
  if (error || !data) return { error: true };
  return { rows: data as Row[] };
}

export interface ConfirmBody {
  answer?: unknown;
  projectId?: unknown;
  replaces?: unknown;
}

export type ConfirmResult =
  | { status: 200; body: { request: CoachRequest; tasks: CoachTask[] } }
  | { status: 400 | 404 | 500; body: { error: string } };

/**
 * "Looks right": the request becomes its tasks. Safe to call twice: only the
 * first call creates anything.
 */
export async function confirmRequest(
  userId: string,
  id: string,
  body: ConfirmBody,
): Promise<ConfirmResult> {
  const row = await loadRequest(id, userId);
  if (!row) return { status: 404, body: { error: "request not found" } };

  // Already confirmed (a second tap): report what exists, change nothing.
  if (row.status !== "new") {
    const current = toRequest(row);
    let tasks = await tasksOfRequest(id, userId);
    // Unless an earlier confirm died between flipping the status and creating
    // the tasks: then this is the only way the chain can ever be built.
    const stale =
      current.confirmedAt !== null &&
      Date.now() - Date.parse(current.confirmedAt) > REPAIR_AFTER_MS;
    if (current.status === "confirmed" && tasks.length === 0 && stale) {
      const repaired = await createChain(current, userId);
      if ("error" in repaired) return { status: 500, body: { error: "Failed to create tasks" } };
      await syncTaskReminders(
        userId,
        repaired.rows.map((r) => r.id as string),
      );
      tasks = withBlocked(repaired.rows);
    }
    return { status: 200, body: { request: current, tasks } };
  }

  let projectId = (row.project_id as string) ?? null;
  if (typeof body.projectId === "string") {
    const { data: project } = await supabase
      .from("coach_projects")
      .select("id")
      .eq("id", body.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) return { status: 400, body: { error: "project not found" } };
    projectId = body.projectId;
  }

  const answer = typeof body.answer === "string" && body.answer.trim() ? body.answer.trim() : null;
  const proposedReplaces = (row.proposed_replaces_id as string) ?? null;
  const replacesId = body.replaces !== false ? proposedReplaces : null;

  // Guarded on status so two concurrent confirms create one chain.
  const { data: confirmed } = await supabase
    .from("coach_requests")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      answer,
      project_id: projectId,
      replaces_id: replacesId,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "new")
    .select("*")
    .maybeSingle();
  if (!confirmed) {
    const current = (await loadRequest(id, userId)) ?? row;
    return {
      status: 200,
      body: { request: toRequest(current), tasks: await tasksOfRequest(id, userId) },
    };
  }
  const request = toRequest(confirmed as Row);

  const created = await createChain(request, userId);
  if ("error" in created) {
    // Put it back so "Looks right" can be tapped again; nothing else has changed yet.
    await supabase
      .from("coach_requests")
      .update({ status: "new", confirmed_at: null, answer: null, replaces_id: null })
      .eq("id", id)
      .eq("user_id", userId);
    return { status: 500, body: { error: "Failed to create tasks" } };
  }

  let droppedIds: string[] = [];
  if (replacesId) {
    // The earlier request stays, marked; nothing is deleted. Work still open
    // for it is superseded, so it leaves the plate (dropped, not removed).
    await supabase
      .from("coach_requests")
      .update({ status: "replaced" })
      .eq("id", replacesId)
      .eq("user_id", userId);
    const { data: dropped } = await supabase
      .from("coach_tasks")
      .update({ state: "dropped" })
      .eq("request_id", replacesId)
      .eq("user_id", userId)
      .in("state", ["open", "waiting"])
      .select("id");
    droppedIds = ((dropped as { id: string }[]) ?? []).map((t) => t.id);
  }

  // New tasks get their reminders; dropped ones lose theirs.
  await syncTaskReminders(userId, [...created.rows.map((r) => r.id as string), ...droppedIds]);

  return { status: 200, body: { request, tasks: withBlocked(created.rows) } };
}

/** Tell the learning job a question was answered, so it can propose a rule. */
export async function announceAnswer(userId: string, requestId: string): Promise<void> {
  try {
    await inngest.send({ name: "coach/answer.given", data: { userId, requestId } });
  } catch {
    // Learning is a nicety; never fail a confirm over it.
  }
}
