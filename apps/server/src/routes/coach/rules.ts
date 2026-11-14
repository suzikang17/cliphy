import { Hono } from "hono";
import type { CoachRule } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";

export const ruleRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

export function toRule(row: Row): CoachRule {
  return {
    id: row.id as string,
    sentence: row.sentence as string,
    personId: (row.person_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    active: row.active !== false,
    createdAt: row.created_at as string,
  };
}

// What the bot has learned. If it is not listed here, it has not learned it.

ruleRoutes.get("/", async (c) => {
  const { data } = await supabase
    .from("coach_rules")
    .select("*")
    .eq("user_id", c.get("userId"))
    .order("created_at", { ascending: false });
  return c.json({ rules: ((data as Row[]) ?? []).map(toRule) });
});

ruleRoutes.patch("/:id", async (c) => {
  const body = await c.req.json<{ sentence?: unknown; active?: unknown }>();
  const values: Row = {};
  if (body.sentence !== undefined) {
    const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
    if (!sentence) return c.json({ error: "sentence is required" }, 400);
    values.sentence = sentence;
  }
  if (body.active !== undefined) values.active = Boolean(body.active);
  if (Object.keys(values).length === 0) return c.json({ error: "nothing to update" }, 400);

  const { data } = await supabase
    .from("coach_rules")
    .update(values)
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"))
    .select("*")
    .maybeSingle();
  if (!data) return c.json({ error: "rule not found" }, 404);
  return c.json({ rule: toRule(data as Row) });
});

ruleRoutes.delete("/:id", async (c) => {
  await supabase
    .from("coach_rules")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"));
  return c.json({ ok: true });
});
