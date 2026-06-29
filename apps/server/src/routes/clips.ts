import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import type { ClipAddRequest } from "@cliphy/shared";

export const clipsRoutes = new Hono<AppEnv>();

clipsRoutes.use("*", authMiddleware);

clipsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<ClipAddRequest>();

  if (!body.sourceType || !["youtube", "tweet"].includes(body.sourceType)) {
    return c.json({ error: "Invalid sourceType" }, 400);
  }
  if (!body.sourceUrl) {
    return c.json({ error: "sourceUrl is required" }, 400);
  }
  if (body.sourceType === "tweet" && !body.content) {
    return c.json({ error: "content is required for tweets" }, 400);
  }

  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: body.sourceType,
      source_url: body.sourceUrl,
      content: body.content ?? null,
      author: body.author ?? null,
      published_at: body.publishedAt ?? null,
      video_title: body.title ?? null,
      source_metadata: body.sourceMetadata ?? null,
      status: "completed",
      tags: [],
    })
    .select("*")
    .single();

  if (error) {
    return c.json({ error: "Failed to save clip" }, 500);
  }

  await inngest.send({
    name: "clip/embed.requested",
    data: { clipId: row.id },
  });

  return c.json({ clip: toClip(row) }, 201);
});
