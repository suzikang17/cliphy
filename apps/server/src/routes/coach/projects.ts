import { Hono } from "hono";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toProject, toRequest } from "../../lib/coachMappers.js";
import { buildHistory } from "../../services/coach/history.js";
import { toProgressEntry } from "./progress.js";
import { projectTag, seedProjectsFromTags } from "../../services/coach/projects.js";

export const projectRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

/** The subset of `ids` that are people belonging to this user. */
async function ownPersonIds(userId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const wanted = ids.filter((i): i is string => typeof i === "string");
  if (wanted.length === 0) return [];
  const { data } = await supabase
    .from("coach_people")
    .select("id")
    .eq("user_id", userId)
    .in("id", wanted);
  return ((data as { id: string }[]) ?? []).map((r) => r.id);
}

async function peopleByProject(projectIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (projectIds.length === 0) return map;
  const { data } = await supabase
    .from("coach_project_people")
    .select("project_id, person_id")
    .in("project_id", projectIds);
  for (const r of (data as { project_id: string; person_id: string }[]) ?? []) {
    map.set(r.project_id, [...(map.get(r.project_id) ?? []), r.person_id]);
  }
  return map;
}

projectRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("coach_projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: "Failed to load projects" }, 500);
  const rows = (data as Row[]) ?? [];
  const people = await peopleByProject(rows.map((r) => r.id as string));
  return c.json({ projects: rows.map((r) => toProject(r, people.get(r.id as string) ?? [])) });
});

projectRoutes.post("/seed", async (c) => {
  const created = await seedProjectsFromTags(c.get("userId"));
  return c.json({ created });
});

projectRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: unknown; personIds?: unknown }>();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const tag = projectTag(name);
  if (!name || tag === "project:") return c.json({ error: "name is required" }, 400);

  const { data, error } = await supabase
    .from("coach_projects")
    .insert({ user_id: userId, name, tag })
    .select("*")
    .single();
  if ((error as { code?: string } | null)?.code === "23505") {
    return c.json({ error: "project already exists" }, 409);
  }
  if (error || !data) return c.json({ error: "Failed to create project" }, 500);

  const row = data as Row;
  const personIds = await ownPersonIds(userId, body.personIds);
  if (personIds.length > 0) {
    await supabase
      .from("coach_project_people")
      .insert(personIds.map((person_id) => ({ project_id: row.id, person_id })));
  }
  return c.json({ project: toProject(row, personIds) }, 201);
});

projectRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: unknown;
    active?: unknown;
    stateLine?: unknown;
    personIds?: unknown;
  }>();

  const values: Row = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name is required" }, 400);
    values.name = name; // The tag is the project's identity and does not follow a rename.
  }
  if (body.active !== undefined) values.active = Boolean(body.active);
  if (body.stateLine !== undefined) values.state_line = String(body.stateLine).trim();

  const query = Object.keys(values).length
    ? supabase.from("coach_projects").update(values).eq("id", id).eq("user_id", userId)
    : supabase.from("coach_projects").select("*").eq("id", id).eq("user_id", userId);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) return c.json({ error: "Failed to update project" }, 500);
  if (!data) return c.json({ error: "project not found" }, 404);

  let personIds: string[];
  if (body.personIds !== undefined) {
    personIds = await ownPersonIds(userId, body.personIds);
    await supabase.from("coach_project_people").delete().eq("project_id", id);
    if (personIds.length > 0) {
      await supabase
        .from("coach_project_people")
        .insert(personIds.map((person_id) => ({ project_id: id, person_id })));
    }
  } else {
    personIds = (await peopleByProject([id])).get(id) ?? [];
  }
  return c.json({ project: toProject(data as Row, personIds) });
});

// ── GET /:id/history — the trail of the work ─────────────────────────────

projectRoutes.get("/:id/history", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data: project } = await supabase
    .from("coach_projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return c.json({ error: "project not found" }, 404);

  // Requests still awaiting "Looks right" are not history yet.
  const { data } = await supabase
    .from("coach_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", id)
    .neq("status", "new");
  // Progress photos sit in the same trail as the requests.
  const { data: photoRows } = await supabase
    .from("coach_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const progress = await Promise.all(((photoRows as Row[]) ?? []).map(toProgressEntry));

  return c.json({ entries: buildHistory(((data as Row[]) ?? []).map(toRequest)), progress });
});
