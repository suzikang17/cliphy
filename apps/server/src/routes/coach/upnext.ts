import { Hono } from "hono";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toPerson, toProject } from "../../lib/coachMappers.js";
import { loadSettings } from "../../services/coach/reminders.js";
import { loadTasks } from "../../services/coach/taskStore.js";
import { localParts } from "../../services/coach/time.js";
import { buildUpNext } from "../../services/coach/upNext.js";

export const upNextRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

/** Everything on the user's plate, arranged for the Up next page and the strip in Chat. */
upNextRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const [{ tasks }, peopleRes, projectsRes, settings] = await Promise.all([
    loadTasks(userId),
    supabase.from("coach_people").select("*").eq("user_id", userId),
    supabase
      .from("coach_projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    loadSettings(userId),
  ]);
  const people = ((peopleRes.data as Row[]) ?? []).map(toPerson);
  const projects = ((projectsRes.data as Row[]) ?? []).map((p) => toProject(p, []));
  const today = localParts(new Date(), settings.timezone).date;
  return c.json(buildUpNext(tasks, people, projects, today));
});
