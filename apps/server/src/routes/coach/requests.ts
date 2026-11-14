import { Hono } from "hono";
import { REQUEST_STATUSES, type RequestStatus } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { signImageUrl } from "../../lib/storage.js";
import { toMessage, toRequest } from "../../lib/coachMappers.js";
import {
  announceAnswer,
  confirmRequest,
  fixRequest,
  loadRequest,
  type ConfirmBody,
} from "../../services/coach/requestActions.js";

export const requestRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

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
  const body = await c.req.json<ConfirmBody>().catch(() => ({}) as ConfirmBody);
  const result = await confirmRequest(c.get("userId"), c.req.param("id"), body);
  if (result.status === 200 && typeof body.answer === "string" && body.answer.trim()) {
    await announceAnswer(c.get("userId"), c.req.param("id"));
  }
  return c.json(result.body, result.status);
});

// ── POST /:id/fix — "Fix it": read the messages again with a correction ──

requestRoutes.post("/:id/fix", async (c) => {
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({}) as { note?: unknown });
  const result = await fixRequest(c.get("userId"), c.req.param("id"), body.note);
  return c.json(result.body, result.status);
});
