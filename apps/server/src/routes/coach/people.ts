import { Hono } from "hono";
import { HISTORY_WINDOWS, PERSON_ROLES, type HistoryWindow, type PersonRole } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toPerson } from "../../lib/coachMappers.js";

export const peopleRoutes = new Hono<AppEnv>();

interface PersonBody {
  name?: unknown;
  role?: unknown;
  handles?: unknown;
  captureThread?: unknown;
  historyWindow?: unknown;
  historyDays?: unknown;
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
    values.handles = (body.handles as string[]).map((h) => h.trim()).filter(Boolean);
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
