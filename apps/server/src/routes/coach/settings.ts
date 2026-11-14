import { Hono } from "hono";
import type { CoachHealth } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { loadSettings, syncTaskReminders } from "../../services/coach/reminders.js";
import { isValidTimezone } from "../../services/coach/time.js";

export const settingsRoutes = new Hono<AppEnv>();
export const healthRoutes = new Hono<AppEnv>();

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

settingsRoutes.get("/", async (c) => {
  return c.json({ settings: await loadSettings(c.get("userId")) });
});

settingsRoutes.patch("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    timezone?: unknown;
    quietStart?: unknown;
    quietEnd?: unknown;
    reviewDow?: unknown;
    reviewTime?: unknown;
  }>();

  const values: Record<string, unknown> = {};
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
      return c.json({ error: "timezone must be an IANA timezone name" }, 400);
    }
    values.timezone = body.timezone;
  }
  for (const [field, column] of [
    ["quietStart", "quiet_start"],
    ["quietEnd", "quiet_end"],
    ["reviewTime", "review_time"],
  ] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !TIME.test(value)) {
      return c.json({ error: `${field} must be HH:MM` }, 400);
    }
    values[column] = value;
  }
  if (body.reviewDow !== undefined) {
    const dow = body.reviewDow;
    if (typeof dow !== "number" || !Number.isInteger(dow) || dow < 0 || dow > 6) {
      return c.json({ error: "reviewDow must be 0 (Sunday) to 6" }, 400);
    }
    values.review_dow = dow;
  }
  if (Object.keys(values).length === 0) return c.json({ error: "nothing to update" }, 400);

  const { error } = await supabase
    .from("coach_settings")
    .upsert(
      { user_id: userId, ...values, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return c.json({ error: "Failed to save settings" }, 500);

  // A new timezone or quiet hours moves every pending reminder.
  if ("timezone" in values || "quiet_start" in values || "quiet_end" in values) {
    const { data } = await supabase
      .from("coach_tasks")
      .select("id")
      .eq("user_id", userId)
      .in("state", ["open", "waiting"])
      .not("due_date", "is", null);
    const ids = ((data as { id: string }[]) ?? []).map((t) => t.id);
    if (ids.length > 0) await syncTaskReminders(userId, ids);
  }

  return c.json({ settings: await loadSettings(userId) });
});

// ── GET /health — can reminders reach this person? ───────────────────────

healthRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const [{ data: tokens }, { data: settings }] = await Promise.all([
    supabase.from("push_tokens").select("token").eq("user_id", userId),
    supabase
      .from("coach_settings")
      .select("push_failures, last_delivered_at, timezone")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const pushTokens = ((tokens as unknown[]) ?? []).length;
  const row = settings as {
    push_failures?: number;
    last_delivered_at?: string;
    timezone?: string | null;
  } | null;
  const health: CoachHealth = {
    pushTokens,
    timezoneSet: Boolean(row?.timezone),
    // No device registered, or two reminders in a row the phone never reported receiving.
    pushOk: pushTokens > 0 && (row?.push_failures ?? 0) < 2,
    lastDeliveredAt: row?.last_delivered_at ?? null,
  };
  return c.json(health);
});
