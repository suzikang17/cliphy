import { Hono } from "hono";
import { REQUEST_STATUSES, type CoachTask, type RequestStatus } from "@cliphy/shared";
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

requestRoutes.post("/:id/confirm", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req
    .json<{ answer?: unknown; projectId?: unknown; replaces?: unknown }>()
    .catch(() => ({}) as { answer?: unknown; projectId?: unknown; replaces?: unknown });

  const row = await loadRequest(id, userId);
  if (!row) return c.json({ error: "request not found" }, 404);

  const unchanged = async (current: Row) =>
    c.json({ request: toRequest(current), tasks: await tasksOfRequest(id, userId) });
  // Already confirmed (a second tap): report what exists, change nothing.
  if (row.status !== "new") return unchanged(row);

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
  if (!confirmed) return unchanged((await loadRequest(id, userId)) ?? row);
  const request = toRequest(confirmed as Row);

  if (replacesId) {
    // The earlier request stays, marked; nothing is deleted.
    await supabase
      .from("coach_requests")
      .update({ status: "replaced" })
      .eq("id", replacesId)
      .eq("user_id", userId);
  }

  const chain = materializeChain(request.proposedTasks, { answered: answer !== null });
  const firstDo = chain.findIndex((t) => t.kind === "do");
  const created: Row[] = [];
  for (const [i, task] of chain.entries()) {
    const { data: inserted, error } = await supabase
      .from("coach_tasks")
      .insert({
        user_id: userId,
        request_id: id,
        project_id: projectId,
        kind: task.kind,
        title: task.title,
        kit: task.kit,
        with_person_id: task.withPerson ? request.personId : null,
        after_task_id:
          task.afterIndex !== null ? ((created[task.afterIndex]?.id as string) ?? null) : null,
        due_date: i === firstDo ? request.dueDate : null,
        position: task.position,
      })
      .select("*")
      .single();
    if (error || !inserted) return c.json({ error: "Failed to create tasks" }, 500);
    created.push(inserted as Row);
  }

  return c.json({ request, tasks: withBlocked(created) });
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
  // A misreading nobody confirmed is discarded; the messages themselves stay.
  await supabase.from("coach_requests").delete().eq("id", id).eq("user_id", userId);
  await supabase
    .from("coach_bundles")
    .update({ fix_note: note, status: "collecting", kind: null })
    .eq("id", bundleId)
    .eq("user_id", userId);
  await inngest.send({ name: "coach/bundle.fix", data: { bundleId, userId } });

  return c.json({ ok: true }, 202);
});
