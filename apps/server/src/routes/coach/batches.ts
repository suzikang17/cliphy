import { Hono } from "hono";
import { BATCH_ITEM_STATES, type BatchItemState } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toMessage, toRequest, toTask } from "../../lib/coachMappers.js";
import {
  loadBatch,
  loadItems,
  messagesForItems,
  signAttachments,
  toBatch,
  toBatchItem,
} from "../../services/coach/batches.js";
import { canSummarize, writeSummary } from "../../services/coach/batchSummary.js";

export const batchRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

/** How many of the client's recent messages are offered for pulling in. */
const MESSAGE_LIMIT = 200;
/** How many of the owner's own messages show the model how she writes. */
const VOICE_LIMIT = 8;

const idList = (v: unknown): string[] | null =>
  v === undefined
    ? []
    : Array.isArray(v) && v.every((x) => typeof x === "string")
      ? [...new Set(v as string[])]
      : null;

// ── GET / — a client's batches, newest first ─────────────────────────────

batchRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const personId = c.req.query("personId");
  const projectId = c.req.query("projectId");

  let query = supabase.from("coach_batches").select("*").eq("user_id", userId);
  if (personId) query = query.eq("person_id", personId);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return c.json({ error: "Failed to load batches" }, 500);
  const rows = (data as Row[]) ?? [];

  let items: Row[] = [];
  if (rows.length > 0) {
    const { data: itemRows } = await supabase
      .from("coach_batch_items")
      .select("batch_id, state")
      .eq("user_id", userId)
      .in(
        "batch_id",
        rows.map((r) => r.id as string),
      );
    items = (itemRows as Row[]) ?? [];
  }
  return c.json({
    batches: rows.map((r) =>
      toBatch(
        r,
        items.filter((i) => i.batch_id === r.id),
      ),
    ),
  });
});

// ── GET /candidates — what can go into a new batch ───────────────────────

// ── GET /ready — finished work not yet reported ──────────────────────────
// A request is ready once it was confirmed, at least one of its tasks was
// done and none is still open. A task added by hand is ready once done.
// Anything already in a batch is left out, unless it was carried out of it.

batchRoutes.get("/ready", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");

  const [requestRes, taskRes, itemRes] = await Promise.all([
    supabase
      .from("coach_requests")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false }),
    supabase.from("coach_tasks").select("*").eq("user_id", userId),
    supabase.from("coach_batch_items").select("request_id, task_id, state").eq("user_id", userId),
  ]);
  const tasks = (taskRes.data as Row[]) ?? [];

  const taken = new Set<string>();
  for (const item of (itemRes.data as Row[]) ?? []) {
    if (item.state === "not_done") continue;
    for (const key of ["request_id", "task_id"]) {
      if (typeof item[key] === "string") taken.add(item[key] as string);
    }
  }

  const live = (state: unknown) => state === "open" || state === "waiting";
  const inProject = (row: Row) => !projectId || row.project_id === projectId;
  const requests = ((requestRes.data as Row[]) ?? [])
    .filter((r) => r.status === "confirmed" && r.historical !== true)
    .filter((r) => inProject(r) && !taken.has(r.id as string))
    .filter((r) => {
      const mine = tasks.filter((t) => t.request_id === r.id);
      return mine.some((t) => t.state === "done") && !mine.some((t) => live(t.state));
    });
  const byHand = tasks
    .filter((t) => !t.request_id && t.state === "done")
    .filter((t) => inProject(t) && !taken.has(t.id as string));

  return c.json({
    requests: requests.map(toRequest),
    tasks: byHand.map((t) => toTask(t, false)),
  });
});

batchRoutes.get("/candidates", async (c) => {
  const userId = c.get("userId");
  const personId = c.req.query("personId");
  const projectId = c.req.query("projectId");
  if (!personId) return c.json({ error: "personId is required" }, 400);

  const [requestRes, itemRes, messageRes] = await Promise.all([
    supabase
      .from("coach_requests")
      .select("*")
      .eq("user_id", userId)
      .eq("person_id", personId)
      .order("created_at", { ascending: false }),
    supabase
      .from("coach_batch_items")
      .select("request_id, message_id, task_id, state")
      .eq("user_id", userId),
    supabase
      .from("coach_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("person_id", personId)
      .eq("direction", "in")
      .order("sent_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
  ]);
  const requests = (requestRes.data as Row[]) ?? [];

  // Anything in a batch is taken, unless it was carried over as not done.
  const taken = new Set<string>();
  for (const i of (itemRes.data as Row[]) ?? []) {
    if (i.state === "not_done") continue;
    for (const key of ["request_id", "message_id", "task_id"]) {
      if (typeof i[key] === "string") taken.add(i[key] as string);
    }
  }

  // A message behind a request is offered as that request, not on its own.
  const requestBundles = new Set(requests.map((r) => r.bundle_id as string));
  const messages = ((messageRes.data as Row[]) ?? [])
    .filter((m) => !taken.has(m.id as string))
    .filter((m) => !m.bundle_id || !requestBundles.has(m.bundle_id as string))
    .filter((m) => ((m.text as string) ?? "").trim() || ((m.attachments as unknown[]) ?? []).length)
    .map(toMessage);

  let tasks: Row[] = [];
  if (projectId) {
    const { data } = await supabase
      .from("coach_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .is("request_id", null)
      .neq("state", "dropped")
      .order("created_at", { ascending: false });
    tasks = ((data as Row[]) ?? []).filter((t) => !taken.has(t.id as string));
  }

  return c.json({
    requests: requests
      .filter((r) => r.status !== "replaced" && !taken.has(r.id as string))
      .map(toRequest),
    messages,
    tasks: tasks.map((t) => toTask(t, false)),
  });
});

// ── POST / — make a batch from finished work ─────────────────────────────

batchRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  if (typeof body.personId !== "string") return c.json({ error: "personId is required" }, 400);
  const requestIds = idList(body.requestIds);
  const messageIds = idList(body.messageIds);
  const taskIds = idList(body.taskIds);
  if (!requestIds || !messageIds || !taskIds) {
    return c.json({ error: "requestIds, messageIds and taskIds must be lists of ids" }, 400);
  }
  if (requestIds.length + messageIds.length + taskIds.length === 0) {
    return c.json({ error: "Pick at least one thing" }, 400);
  }

  const { data: person } = await supabase
    .from("coach_people")
    .select("id")
    .eq("id", body.personId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!person) return c.json({ error: "person not found" }, 404);

  let projectId: string | null = null;
  if (typeof body.projectId === "string") {
    const { data: project } = await supabase
      .from("coach_projects")
      .select("id")
      .eq("id", body.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) return c.json({ error: "project not found" }, 404);
    projectId = body.projectId;
  }

  // Everything picked must be this user's, and this client's where it has one.
  const labels: { request_id?: string; message_id?: string; task_id?: string; label: string }[] =
    [];
  if (requestIds.length > 0) {
    const { data } = await supabase
      .from("coach_requests")
      .select("id, understood")
      .eq("user_id", userId)
      .eq("person_id", body.personId)
      .in("id", requestIds);
    const found = new Map(((data as Row[]) ?? []).map((r) => [r.id as string, r]));
    for (const id of requestIds) {
      const row = found.get(id);
      if (!row) return c.json({ error: "request not found" }, 404);
      labels.push({ request_id: id, label: (row.understood as string) ?? "" });
    }
  }
  if (messageIds.length > 0) {
    const { data } = await supabase
      .from("coach_messages")
      .select("id, text")
      .eq("user_id", userId)
      .eq("person_id", body.personId)
      .in("id", messageIds);
    const found = new Map(((data as Row[]) ?? []).map((r) => [r.id as string, r]));
    for (const id of messageIds) {
      const row = found.get(id);
      if (!row) return c.json({ error: "message not found" }, 404);
      labels.push({ message_id: id, label: ((row.text as string) ?? "").trim() || "Photo" });
    }
  }
  if (taskIds.length > 0) {
    const { data } = await supabase
      .from("coach_tasks")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", taskIds);
    const found = new Map(((data as Row[]) ?? []).map((r) => [r.id as string, r]));
    for (const id of taskIds) {
      const row = found.get(id);
      if (!row) return c.json({ error: "task not found" }, 404);
      labels.push({ task_id: id, label: (row.title as string) ?? "" });
    }
  }

  const { data: created, error } = await supabase
    .from("coach_batches")
    .insert({ user_id: userId, person_id: body.personId, project_id: projectId })
    .select("*")
    .single();
  if (error || !created) return c.json({ error: "Failed to make the batch" }, 500);
  const batch = created as Row;

  const items = labels.map((l, position) => ({
    user_id: userId,
    batch_id: batch.id as string,
    request_id: l.request_id ?? null,
    message_id: l.message_id ?? null,
    ...(l.task_id ? { task_id: l.task_id } : {}),
    label: l.label,
    position,
  }));
  const { error: itemError } = await supabase.from("coach_batch_items").insert(items);
  if (itemError) {
    // A batch with no items is useless and cannot be checked: take it back.
    await supabase.from("coach_batches").delete().eq("id", batch.id).eq("user_id", userId);
    return c.json({ error: "Failed to make the batch" }, 500);
  }

  return c.json(
    {
      batch: toBatch(
        batch,
        items.map(() => ({ state: "unchecked" })),
      ),
    },
    201,
  );
});

// ── GET /:id — the checklist, each item beside what the client sent ──────

batchRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);

  const rows = await loadItems(batch.id as string, userId);
  const sent = await messagesForItems(rows, userId);
  const items = rows.map((r) => ({ ...toBatchItem(r), messages: sent.get(r.id as string) ?? [] }));
  for (const item of items) await signAttachments(item.messages);

  return c.json({ batch: toBatch(batch, rows), items });
});

// ── PATCH /:id — edit the summary before sending ─────────────────────────

batchRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ summary?: unknown }>().catch(() => ({}) as { summary?: unknown });
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);
  if (batch.status === "sent") return c.json({ error: "This batch was sent" }, 409);
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) return c.json({ error: "summary is required" }, 400);

  // A summary written elsewhere (Claude Code, which did the work) makes the
  // batch ready, on the same terms as one written here: every item checked.
  const rows = await loadItems(batch.id as string, userId);
  const values: { summary: string; status?: "ready" } = { summary };
  if (batch.status === "checking") {
    if (!canSummarize(rows.map(toBatchItem))) {
      return c.json({ error: "Check every item first" }, 409);
    }
    values.status = "ready";
  }

  const { error } = await supabase
    .from("coach_batches")
    .update(values)
    .eq("id", batch.id as string)
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to save the summary" }, 500);
  return c.json({ batch: toBatch({ ...batch, ...values }, rows) });
});

// ── PATCH /:id/items/:itemId — tick an item, or carry it over ────────────

batchRoutes.patch("/:id/items/:itemId", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ state?: unknown; note?: unknown }>()
    .catch(() => ({}) as { state?: unknown; note?: unknown });
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);
  if (batch.status === "sent") return c.json({ error: "This batch was sent" }, 409);

  const values: { state?: BatchItemState; note?: string | null } = {};
  if (body.state !== undefined) {
    if (!BATCH_ITEM_STATES.includes(body.state as BatchItemState)) {
      return c.json({ error: "state must be unchecked, done or not_done" }, 400);
    }
    values.state = body.state as BatchItemState;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== "string") {
      return c.json({ error: "note must be text" }, 400);
    }
    values.note = typeof body.note === "string" ? body.note.trim() || null : null;
  }
  if (Object.keys(values).length === 0) return c.json({ error: "nothing to change" }, 400);

  const { data } = await supabase
    .from("coach_batch_items")
    .update(values)
    .eq("id", c.req.param("itemId"))
    .eq("batch_id", batch.id as string)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (!data) return c.json({ error: "item not found" }, 404);
  return c.json({ item: toBatchItem(data as Row) });
});

// ── POST /:id/summary — write the message for the client ─────────────────

batchRoutes.post("/:id/summary", async (c) => {
  const userId = c.get("userId");
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);
  if (batch.status === "sent") return c.json({ error: "This batch was sent" }, 409);

  const rows = await loadItems(batch.id as string, userId);
  const items = rows.map(toBatchItem);
  if (!canSummarize(items)) return c.json({ error: "Check every item first" }, 409);

  const requestIds = items.map((i) => i.requestId).filter(Boolean) as string[];
  const [personRes, projectRes, sent, taskRes, voiceRes] = await Promise.all([
    supabase
      .from("coach_people")
      .select("name")
      .eq("id", batch.person_id as string)
      .eq("user_id", userId)
      .maybeSingle(),
    batch.project_id
      ? supabase
          .from("coach_projects")
          .select("name")
          .eq("id", batch.project_id as string)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    messagesForItems(rows, userId),
    requestIds.length > 0
      ? supabase
          .from("coach_tasks")
          .select("request_id, title, state")
          .eq("user_id", userId)
          .in("request_id", requestIds)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase
      .from("coach_messages")
      .select("text")
      .eq("user_id", userId)
      .eq("person_id", batch.person_id as string)
      .eq("direction", "out")
      .order("sent_at", { ascending: false })
      .limit(VOICE_LIMIT),
  ]);
  const tasks = (taskRes.data as Row[]) ?? [];
  const texts = (list: { text: string }[]) => list.map((m) => m.text.trim()).filter(Boolean);

  let summary: string;
  try {
    summary = await writeSummary({
      clientName: ((personRes.data as Row | null)?.name as string) ?? "the client",
      projectName: ((projectRes.data as Row | null)?.name as string) ?? null,
      items: items.map((item) => ({
        label: item.label,
        asked: texts(sent.get(item.id) ?? []),
        work: tasks
          .filter((t) => t.request_id === item.requestId && t.state === "done")
          .map((t) => t.title as string),
        state: item.state,
        note: item.note,
      })),
      voice: texts(
        ((voiceRes.data as Row[]) ?? []).map((m) => ({ text: (m.text as string) ?? "" })),
      ),
    });
  } catch {
    return c.json({ error: "Could not write the summary. Try again." }, 502);
  }

  const { error } = await supabase
    .from("coach_batches")
    .update({ summary, status: "ready" })
    .eq("id", batch.id as string)
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to save the summary" }, 500);
  return c.json({ batch: toBatch({ ...batch, summary, status: "ready" }, rows) });
});

// ── POST /:id/sent — the owner sent it herself ───────────────────────────

batchRoutes.post("/:id/sent", async (c) => {
  const userId = c.get("userId");
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);
  const rows = await loadItems(batch.id as string, userId);
  if (batch.status === "sent") return c.json({ batch: toBatch(batch, rows) });
  if (batch.status !== "ready") return c.json({ error: "There is no summary yet" }, 409);

  const sentAt = new Date().toISOString();
  const { error } = await supabase
    .from("coach_batches")
    .update({ status: "sent", sent_at: sentAt })
    .eq("id", batch.id as string)
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to mark it sent" }, 500);
  return c.json({ batch: toBatch({ ...batch, status: "sent", sent_at: sentAt }, rows) });
});

// ── DELETE /:id — drop a batch that was never sent ───────────────────────

batchRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const batch = await loadBatch(c.req.param("id"), userId);
  if (!batch) return c.json({ error: "batch not found" }, 404);
  // A sent batch is the record of what the client was told.
  if (batch.status === "sent") return c.json({ error: "This batch was sent" }, 409);

  const { error } = await supabase
    .from("coach_batches")
    .delete()
    .eq("id", batch.id as string)
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to remove the batch" }, 500);
  return c.json({ ok: true });
});
