import { Hono } from "hono";
import type { ProgressEntry } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { signImageUrl } from "../../lib/storage.js";
import { progressAsk, progressFiled } from "../../services/coach/botMessages.js";
import { postBotMessage } from "../../services/coach/chat.js";
import { fileProgress, type FilingTier } from "../../services/coach/filing.js";
import { loadSettings } from "../../services/coach/reminders.js";
import { createImageClip } from "../../services/imageClip.js";

export const progressRoutes = new Hono<AppEnv>();

const log = logger.child({ route: "coach-progress" });

type Row = Record<string, unknown>;

export async function toProgressEntry(row: Row): Promise<ProgressEntry> {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    url: await signImageUrl(row.storage_path as string),
    createdAt: row.created_at as string,
  };
}

/**
 * A photo of work in progress. It files itself:
 * - sure (she named the project, or said what she is on in the last few
 *   hours): filed quietly; the phone shows where.
 * - fairly sure: filed, and the bot says where in chat with a way to move it.
 * - unsure: saved without a project, and the bot asks once.
 */
progressRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ storagePath?: unknown; projectId?: unknown }>()
    .catch(() => ({}) as { storagePath?: unknown; projectId?: unknown });

  const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  if (!storagePath.startsWith(`coach/${userId}/`) || storagePath.split("/").includes("..")) {
    return c.json({ error: "invalid photo path" }, 400);
  }

  const { data: projectRows } = await supabase
    .from("coach_projects")
    .select("id, name, tag")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  const projects = (projectRows as { id: string; name: string; tag: string }[]) ?? [];

  let projectId: string | null;
  let tier: FilingTier;
  if (body.projectId !== undefined && body.projectId !== null) {
    if (!projects.some((p) => p.id === body.projectId)) {
      return c.json({ error: "project not found" }, 400);
    }
    projectId = body.projectId as string;
    tier = "sure";
  } else {
    const { focus } = await loadSettings(userId);
    ({ projectId, tier } = fileProgress({
      focus: focus ?? null,
      activeProjects: projects.map((p) => p.id),
      now: new Date(),
    }));
  }
  const project = projects.find((p) => p.id === projectId) ?? null;

  // The photo is also a Library clip. The photo matters more than its copy.
  let clipId: string | null = null;
  try {
    clipId = (await createImageClip(userId, storagePath, project ? [project.tag] : []))
      .id as string;
  } catch (err) {
    log.warn("Could not create clip for progress photo", { err: String(err) });
  }

  const { data: inserted, error } = await supabase
    .from("coach_progress")
    .insert({
      user_id: userId,
      project_id: project?.id ?? null,
      storage_path: storagePath,
      clip_id: clipId,
    })
    .select("*")
    .single();
  if (error || !inserted) return c.json({ error: "Failed to save photo" }, 500);
  const entry = await toProgressEntry(inserted as Row);

  if (tier === "fairly" && project) {
    await postBotMessage(userId, progressFiled(entry, project, projects));
  } else if (tier === "unsure") {
    await postBotMessage(userId, progressAsk(entry, projects));
  }

  return c.json(
    { entry, tier, project: project ? { id: project.id, name: project.name } : null },
    201,
  );
});
