import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  REQUEST_STATUSES,
  type CoachRequest,
  type CoachTask,
  type RequestStatus,
} from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { inngest } from "../../lib/inngest.js";
import { signImageUrl } from "../../lib/storage.js";
import { toMessage, toRequest, toTask } from "../../lib/coachMappers.js";
import { isBlocked, materializeChain } from "../../services/coach/chain.js";

export const requestRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

async function loadRequest(id: string, userId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("coach_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Task rows → API tasks, with `blocked` computed within the set. */
function withBlocked(rows: Row[]): CoachTask[] {
  const byId = new Map(rows.map((r) => [r.id as string, { state: r.state as CoachTask["state"] }]));
  return rows.map((r) =>
    toTask(r, isBlocked({ afterTaskId: (r.after_task_id as string) ?? null }, byId)),
  );
}

async function tasksOfRequest(requestId: string, userId: string): Promise<CoachTask[]> {
  const { data } = await supabase
    .from("coach_tasks")
    .select("*")
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  return withBlocked((data as Row[]) ?? []);
}

// ── GET / — requests, newest first ───────────────────────────────────────

requestRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status");
  if (status !== undefined && !REQUEST_STATUSES.includes(status as RequestStatus)) {
    return c.json({ error: "status must be new, confirmed, replaced or closed" }, 400);
  }

  let query = supabase.from("coach_requests").select("*").eq("user_id", userId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return c.json({ error: "Failed to load requests" }, 500);
  return c.json({ requests: ((data as Row[]) ?? []).map(toRequest) });
});

// ── GET /:id — one request with what was sent ────────────────────────────

requestRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const row = await loadRequest(c.req.param("id"), userId);
  if (!row) return c.json({ error: "request not found" }, 404);
  const request = toRequest(row);

  const { data: messageRows } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("bundle_id", request.bundleId)
    .eq("user_id", userId)
    .order("sent_at", { ascending: true });
  const messages = ((messageRows as Row[]) ?? []).map(toMessage);
  for (const m of messages) {
    for (const a of m.attachments) a.url = (await signImageUrl(a.storagePath)) ?? undefined;
  }

  // While new, show what it would replace; afterwards, what it did replace.
  const replacesId = request.status === "new" ? request.proposedReplacesId : request.replacesId;
  const replacesRow = replacesId ? await loadRequest(replacesId, userId) : null;

  return c.json({ request, messages, replaces: replacesRow ? toRequest(replacesRow) : null });
});

// ── POST /:id/confirm — "Looks right": the request becomes its tasks ─────

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

requestRoutes.post("/:id/confirm", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req
    .json<{ answer?: unknown; projectId?: unknown; replaces?: unknown }>()
    .catch(() => ({}) as { answer?: unknown; projectId?: unknown; replaces?: unknown });

  const row = await loadRequest(id, userId);
  if (!row) return c.json({ error: "request not found" }, 404);

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
      if ("error" in repaired) return c.json({ error: "Failed to create tasks" }, 500);
      tasks = withBlocked(repaired.rows);
    }
    return c.json({ request: current, tasks });
  }

  let projectId = (row.project_id as string) ?? null;
  if (typeof body.projectId === "string") {
    const { data: project } = await supabase
      .from("coach_projects")
      .select("id")
      .eq("id", body.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) return c.json({ error: "project not found" }, 400);
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
    return c.json({ request: toRequest(current), tasks: await tasksOfRequest(id, userId) });
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
    return c.json({ error: "Failed to create tasks" }, 500);
  }

  if (replacesId) {
    // The earlier request stays, marked; nothing is deleted. Work still open
    // for it is superseded, so it leaves the plate (dropped, not removed).
    await supabase
      .from("coach_requests")
      .update({ status: "replaced" })
      .eq("id", replacesId)
      .eq("user_id", userId);
    await supabase
      .from("coach_tasks")
      .update({ state: "dropped" })
      .eq("request_id", replacesId)
      .eq("user_id", userId)
      .in("state", ["open", "waiting"]);
  }

  return c.json({ request, tasks: withBlocked(created.rows) });
});

// ── POST /:id/fix — "Fix it": read the messages again with a correction ──

requestRoutes.post("/:id/fix", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({}) as { note?: unknown });
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return c.json({ error: "note is required" }, 400);

  const row = await loadRequest(id, userId);
  if (!row) return c.json({ error: "request not found" }, 404);
  if (row.status !== "new") return c.json({ error: "request is already confirmed" }, 409);

  const bundleId = row.bundle_id as string;
  await supabase
    .from("coach_bundles")
    .update({ fix_note: note, status: "collecting", kind: null })
    .eq("id", bundleId)
    .eq("user_id", userId);

  // Start the re-read before discarding the misreading: if it cannot be
  // started, the request must still be there to try again.
  try {
    await inngest.send({ name: "coach/bundle.fix", data: { bundleId, userId } });
  } catch {
    return c.json({ error: "Could not start the re-read" }, 500);
  }
  // A misreading nobody confirmed is discarded; the messages themselves stay.
  await supabase.from("coach_requests").delete().eq("id", id).eq("user_id", userId);

  return c.json({ ok: true }, 202);
});
