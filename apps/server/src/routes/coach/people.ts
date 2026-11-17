import { Hono } from "hono";
import { HISTORY_WINDOWS, PERSON_ROLES, type HistoryWindow, type PersonRole } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toMessage, toPerson } from "../../lib/coachMappers.js";
import { signAttachments } from "../../services/coach/batches.js";
import { messageMarks } from "../../services/coach/thread.js";

export const peopleRoutes = new Hono<AppEnv>();

interface PersonBody {
  name?: unknown;
  role?: unknown;
  handles?: unknown;
  captureThread?: unknown;
  historyWindow?: unknown;
  historyDays?: unknown;
}

/**
 * A phone number or email in the form Messages stores it, so the Mac helper
 * can find the thread: numbers as +15551234567, emails in lower case.
 * A 10-digit number is taken to be US/Canada; one with a leading + keeps its
 * country code.
 */
export function normalizeHandle(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.includes("@")) return value.toLowerCase();
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (value.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/** Validate a create (all required fields) or patch (`partial`) body into column values. */
function personColumns(
  body: PersonBody,
  partial: boolean,
): { error: string } | { values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};

  if (body.name !== undefined || !partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { error: "name is required" };
    values.name = name;
  }
  if (body.role !== undefined || !partial) {
    if (!PERSON_ROLES.includes(body.role as PersonRole)) {
      return { error: "role must be client, collaborator or both" };
    }
    values.role = body.role;
  }
  if (body.handles !== undefined) {
    if (!Array.isArray(body.handles) || body.handles.some((h) => typeof h !== "string")) {
      return { error: "handles must be a list of strings" };
    }
    values.handles = [...new Set((body.handles as string[]).map(normalizeHandle).filter(Boolean))];
  }
  if (body.captureThread !== undefined) values.capture_thread = Boolean(body.captureThread);
  if (body.historyWindow !== undefined) {
    if (!HISTORY_WINDOWS.includes(body.historyWindow as HistoryWindow)) {
      return { error: "historyWindow must be new, window or all" };
    }
    values.history_window = body.historyWindow;
    if (body.historyWindow === "window") {
      const days = body.historyDays;
      if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) {
        return { error: "historyDays is required for a window" };
      }
      values.history_days = days;
    } else {
      values.history_days = null;
    }
  }
  return { values };
}

peopleRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("coach_people")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: "Failed to load people" }, 500);
  return c.json({ people: ((data as Record<string, unknown>[]) ?? []).map(toPerson) });
});

peopleRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = personColumns(await c.req.json<PersonBody>(), false);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const { data, error } = await supabase
    .from("coach_people")
    .insert({ user_id: userId, ...parsed.values })
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to create person" }, 500);
  return c.json({ person: toPerson(data as Record<string, unknown>) }, 201);
});

peopleRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const parsed = personColumns(await c.req.json<PersonBody>(), true);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  if (Object.keys(parsed.values).length === 0) return c.json({ error: "nothing to update" }, 400);

  const { data, error } = await supabase
    .from("coach_people")
    .update(parsed.values)
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) return c.json({ error: "Failed to update person" }, 500);
  if (!data) return c.json({ error: "person not found" }, 404);
  return c.json({ person: toPerson(data as Record<string, unknown>) });
});

// ── GET /:id/messages — a person's thread ────────────────────────────────

/** How many messages are given when no page size is asked for. */
const RECENT_MESSAGES = 100;
/** The most messages one call reads or changes. */
const MAX_PAGE = 200;

/** The person, if they are this user's. */
async function ownPerson(id: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("coach_people")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * A person's thread, newest first, a page at a time: `limit` (up to
 * MAX_PAGE) and `before` (a time) walk back through all of it. Each message
 * says what has become of it: checked off, turned into a request, in a batch.
 */
peopleRoutes.get("/:id/messages", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const before = c.req.query("before");
  const limitParam = c.req.query("limit");
  const limit = limitParam === undefined ? RECENT_MESSAGES : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    return c.json({ error: `limit must be 1 to ${MAX_PAGE}` }, 400);
  }
  if (before !== undefined && Number.isNaN(Date.parse(before))) {
    return c.json({ error: "before must be a time" }, 400);
  }
  if (!(await ownPerson(id, userId))) return c.json({ error: "person not found" }, 404);

  let query = supabase.from("coach_messages").select("*").eq("user_id", userId).eq("person_id", id);
  if (before) query = query.lt("sent_at", before);
  // One more than asked for says whether anything older remains.
  const { data } = await query.order("sent_at", { ascending: false }).limit(limit + 1);
  const rows = (data as Record<string, unknown>[]) ?? [];
  const page = rows.slice(0, limit);

  const marks = await messageMarks(page, userId);
  const messages = page.map((row) => ({ ...toMessage(row), ...marks.get(row.id as string) }));
  await signAttachments(messages);
  return c.json({ messages, hasMore: rows.length > limit });
});

/** Check messages off (or uncheck them): the owner's own note that they are dealt with. */
peopleRoutes.post("/:id/messages/handled", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req
    .json<{ messageIds?: unknown; handled?: unknown }>()
    .catch(() => ({}) as { messageIds?: unknown; handled?: unknown });
  const ids = Array.isArray(body.messageIds)
    ? body.messageIds.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0 || ids.length > MAX_PAGE) {
    return c.json({ error: "messageIds must be a list of messages" }, 400);
  }
  if (!(await ownPerson(id, userId))) return c.json({ error: "person not found" }, 404);

  const { data, error } = await supabase
    .from("coach_messages")
    .update({ handled_at: body.handled === false ? null : new Date().toISOString() })
    .eq("user_id", userId)
    .eq("person_id", id)
    .in("id", ids)
    .select("id");
  if (error) return c.json({ error: "Failed to update messages" }, 500);
  return c.json({ updated: ((data as unknown[]) ?? []).length });
});
