import { Hono } from "hono";
import type { CoachReminder, ReminderKind, TaskKind } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { reminderText } from "../../services/coach/reminderText.js";

export const reminderRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

/** How far ahead the phone mirrors reminders as local notifications. */
const MIRROR_DAYS = 14;

// ── GET / — upcoming reminders, with their words ─────────────────────────
// The phone schedules these locally as a backup, so a reminder still fires
// when the phone has no signal.

reminderRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const until = new Date(Date.now() + MIRROR_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("coach_reminders")
    .select("id, task_id, kind, fire_at, status")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("fire_at", until)
    .order("fire_at", { ascending: true });
  if (error) return c.json({ error: "Failed to load reminders" }, 500);
  const rows = (data as Row[]) ?? [];
  if (rows.length === 0) return c.json({ reminders: [] });

  const { data: taskRows } = await supabase
    .from("coach_tasks")
    .select("id, title, kind, due_time, with_person_id, request_id")
    .eq("user_id", userId)
    .in("id", [...new Set(rows.map((r) => r.task_id as string))]);
  const tasks = new Map(((taskRows as Row[]) ?? []).map((t) => [t.id as string, t]));

  const personIds = [...tasks.values()].map((t) => t.with_person_id).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (personIds.length > 0) {
    const { data: people } = await supabase
      .from("coach_people")
      .select("id, name")
      .eq("user_id", userId)
      .in("id", [...new Set(personIds)]);
    for (const p of (people as { id: string; name: string }[]) ?? []) names.set(p.id, p.name);
  }

  const reminders: CoachReminder[] = [];
  for (const r of rows) {
    const task = tasks.get(r.task_id as string);
    if (!task) continue;
    const text = reminderText({
      kind: r.kind as ReminderKind,
      title: task.title as string,
      taskKind: task.kind as TaskKind,
      personName: names.get(task.with_person_id as string) ?? null,
      fromRequest: Boolean(task.request_id),
      dueTime: (task.due_time as string) ?? null,
    });
    reminders.push({
      id: r.id as string,
      taskId: r.task_id as string,
      kind: r.kind as ReminderKind,
      fireAt: r.fire_at as string,
      status: "scheduled",
      ...text,
    });
  }
  return c.json({ reminders });
});

// ── POST /:id/delivered — the phone received it ──────────────────────────

reminderRoutes.post("/:id/delivered", async (c) => {
  const userId = c.get("userId");
  const now = new Date().toISOString();
  await supabase
    .from("coach_reminders")
    .update({ status: "delivered", delivered_at: now })
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();

  // Whatever state the reminder was in, the phone just proved it is reachable.
  await supabase
    .from("coach_settings")
    .upsert(
      { user_id: userId, push_failures: 0, last_delivered_at: now },
      { onConflict: "user_id" },
    );
  return c.json({ ok: true });
});

// ── POST /:id/ack — opened or answered; stop reminding ───────────────────

reminderRoutes.post("/:id/ack", async (c) => {
  const userId = c.get("userId");
  await supabase
    .from("coach_reminders")
    .update({ status: "acked", acked_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    // Scheduled too: the phone's local copy may be answered before the server sends.
    .in("status", ["scheduled", "sent", "delivered"])
    .select("id")
    .maybeSingle();
  return c.json({ ok: true });
});
