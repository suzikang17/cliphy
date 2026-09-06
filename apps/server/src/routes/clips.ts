import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import { detectSourceType } from "../services/detectSourceType.js";
import { extractWebClip } from "../services/extractors/web.js";
import { extractTweetClip } from "../services/extractors/tweet.js";
import { signImageUrl } from "../lib/storage.js";
import { findRelatedClips } from "../services/related.js";

export const clipsRoutes = new Hono<AppEnv>();

clipsRoutes.use("*", authMiddleware);

clipsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ url?: string; imagePath?: string }>();

  // Image capture: no URL to classify — create an image clip and hand off to
  // the vision worker.
  if (body.imagePath) {
    const { data: row, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: "image",
        hero_image_url: body.imagePath,
        source_metadata: { storagePath: body.imagePath },
        status: "pending",
        tags: [],
      })
      .select("*")
      .single();
    if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
    await inngest.send({ name: "clip/vision.requested", data: { clipId: row.id } });
    const clip = toClip(row);
    clip.heroImageUrl = (await signImageUrl(body.imagePath)) ?? clip.heroImageUrl;
    return c.json({ clip }, 201);
  }

  if (!body.url) return c.json({ error: "url is required" }, 400);

  const sourceType = detectSourceType(body.url);

  // Dedup: one non-deleted clip per (user, url).
  const { data: existing } = await supabase
    .from("clips")
    .select("id")
    .eq("user_id", userId)
    .eq("source_url", body.url)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return c.json({ error: "DUPLICATE", message: "Clip already saved" }, 409);

  // Build the insert payload from whichever extractor matches.
  const insert: Record<string, unknown> = {
    user_id: userId,
    source_type: sourceType,
    source_url: body.url,
    tags: [],
  };

  try {
    if (sourceType === "web") {
      const web = await extractWebClip(body.url);
      insert.video_title = web.title;
      insert.content = web.content || null;
      insert.excerpt = web.excerpt ?? null;
      insert.hero_image_url = web.heroImageUrl ?? null;
      insert.source_metadata = {
        siteName: web.siteName,
        faviconUrl: web.faviconUrl,
        readingTimeMin: web.readingTimeMin,
        kind: web.kind,
      };
      insert.status = "completed";
    } else if (sourceType === "tweet") {
      const tw = await extractTweetClip(body.url);
      insert.video_title = `${tw.author.name} (@${tw.author.handle})`;
      insert.author = tw.author.handle;
      insert.content = tw.text;
      insert.excerpt = tw.text.slice(0, 200);
      insert.hero_image_url = tw.heroImageUrl ?? null;
      insert.published_at = tw.publishedAt ?? null;
      insert.source_metadata = {
        handle: tw.author.handle,
        avatarUrl: tw.author.avatarUrl,
        media: tw.media,
        quotedTweet: tw.quotedTweet,
        threadTweetIds: tw.threadTweetIds,
        threadTruncated: tw.threadTruncated,
        likeCount: tw.likeCount,
        retweetCount: tw.retweetCount,
      };
      insert.status = "completed";
    } else {
      // youtube/podcast URLs shouldn't reach here from the clips path;
      // save a bare link so nothing is lost.
      insert.status = "completed";
    }
  } catch (err) {
    insert.status = "failed";
    insert.error_message = err instanceof Error ? err.message : "Extraction failed";
    insert.video_title = body.url;
  }

  const { data: row, error } = await supabase.from("clips").insert(insert).select("*").single();
  if (error || !row) return c.json({ error: "Failed to save clip" }, 500);

  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id } });
  return c.json({ clip: toClip(row) }, 201);
});

clipsRoutes.get("/:id/related", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data: owned } = await supabase
    .from("clips")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!owned) return c.json({ clips: [] });
  const clips = await findRelatedClips(id, userId);
  return c.json({ clips });
});
