import { Hono } from "hono";
import { HISTORY_WINDOWS, PERSON_ROLES, type HistoryWindow, type PersonRole } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toMessage, toPerson } from "../../lib/coachMappers.js";
import { signAttachments } from "../../services/coach/batches.js";
import { findRequests, type DigestGroupRef } from "../../services/coach/digest.js";
import { loadSettings } from "../../services/coach/reminders.js";
import { loadTasks } from "../../services/coach/taskStore.js";
import { messageMarks } from "../../services/coach/thread.js";
import { localParts } from "../../services/coach/time.js";

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

// ── POST /:id/digest — the requests in a stretch of someone's texts ──────
// One model call over the last `days` of the thread. Each request comes back
// with the person's own words (checked against the stored message) and that
// message's time and pictures.

/** The most messages read in one go; the newest are kept. */
const DIGEST_MESSAGES = 300;

peopleRoutes.post("/:id/digest", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ days?: unknown }>().catch(() => ({}) as { days?: unknown });
  const days = body.days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365) {
    return c.json({ error: "days must be 1 to 365" }, 400);
  }

  const { data: person } = await supabase
    .from("coach_people")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!person) return c.json({ error: "person not found" }, 404);

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("person_id", id)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(DIGEST_MESSAGES);
  const messages = ((data as Record<string, unknown>[]) ?? [])
    .map(toMessage)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (messages.length === 0) return c.json({ days, messageCount: 0, groups: [] });

  const [{ tasks }, projectRes, settings] = await Promise.all([
    loadTasks(userId),
    supabase.from("coach_projects").select("id, name").eq("user_id", userId).eq("active", true),
    loadSettings(userId),
  ]);

  let groups: DigestGroupRef[];
  try {
    groups = await findRequests({
      personName: (person as { name: string }).name,
      today: localParts(new Date(), settings.timezone).date,
      messages: messages.map((m) => ({
        id: m.id,
        sentAt: m.sentAt,
        direction: m.direction === "out" ? "out" : "in",
        text: m.text,
        pictures: m.attachments.length,
      })),
      openTasks: tasks
        .filter((t) => t.state === "open" || t.state === "waiting")
        .map((t) => ({ id: t.id, title: t.title })),
      projects: ((projectRes.data as { id: string; name: string }[]) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error && err.message ? err.message : "Error" }, 502);
  }

  await signAttachments(messages);
  const byId = new Map(messages.map((m) => [m.id, m]));
  return c.json({
    days,
    messageCount: messages.length,
    groups: groups.map((group) => ({
      name: group.name,
      items: group.items.map((item) => ({
        ...item,
        quotes: item.quotes.map((quote) => ({
          ...quote,
          sentAt: byId.get(quote.messageId)?.sentAt ?? null,
          attachments: byId.get(quote.messageId)?.attachments ?? [],
        })),
      })),
    })),
  });
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
