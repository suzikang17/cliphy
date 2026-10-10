import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import { detectSourceType } from "../services/detectSourceType.js";
import { extractWebClip } from "../services/extractors/web.js";
import { extractTweetClip } from "../services/extractors/tweet.js";
import { extractWebMetadata } from "../services/extractors/webMetadata.js";
import { signImageUrl } from "../lib/storage.js";
import { findRelatedClips } from "../services/related.js";
import { enrichClip } from "../services/enrich.js";
import { runImageVision } from "../services/processImage.js";
import { enqueueVideo } from "../services/enqueue-video.js";
import { quickSave } from "../services/quick-save.js";
import { checkRateLimit } from "../lib/rateLimit.js";

export const clipsRoutes = new Hono<AppEnv>();

clipsRoutes.use("*", authMiddleware);

// ── POST /quick — ⌘⇧S save-this-page from the extension ─────
// Body: { url, title, description?, text? } — the extension sends what it sees,
// so logged-in pages save properly. Returns the clip with tags applied.

const QUICK_LIMIT_PER_HOUR = 120;

clipsRoutes.post("/quick", async (c) => {
  const userId = c.get("userId");
  let body: {
    url?: unknown;
    title?: unknown;
    description?: unknown;
    text?: unknown;
    note?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.url !== "string" || body.url.length > 2048 || !/^https?:\/\//.test(body.url)) {
    return c.json({ error: "A web page url is required" }, 400);
  }
  if (!checkRateLimit(`quick-save:${userId}`, QUICK_LIMIT_PER_HOUR, 60 * 60_000)) {
    return c.json({ error: "Too many saves", code: "RATE_LIMITED" }, 429);
  }
  const r = await quickSave({
    userId,
    url: body.url,
    title: typeof body.title === "string" ? body.title.slice(0, 500) : "",
    description: typeof body.description === "string" ? body.description.slice(0, 500) : undefined,
    text: typeof body.text === "string" ? body.text.slice(0, 6000) : undefined,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 2000) || undefined : undefined,
  });
  if (!r.ok) return c.json(r.body, r.status);
  return c.json(
    {
      clip: toClip(r.clip),
      tags: r.tags,
      suggestedTags: r.suggestedTags,
      duplicate: !!r.duplicate,
      video: !!r.video,
    },
    r.duplicate ? 200 : 201,
  );
});

clipsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    url?: string;
    imagePath?: string;
    tier?: "metadata" | "full";
    /** Your note on the page (from the Tabs view) → the clip's notes. */
    note?: string;
  }>();
  const userNote = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  // Image capture: run vision synchronously (reliable, no worker dependency) so
  // OCR/description + enrichment land at capture time.
  if (body.imagePath) {
    const insert: Record<string, unknown> = {
      user_id: userId,
      source_type: "image",
      hero_image_url: body.imagePath,
      source_metadata: { storagePath: body.imagePath },
      status: "completed",
      tags: [],
    };
    try {
      const v = await runImageVision(body.imagePath);
      insert.content = v.content || null;
      insert.excerpt = v.excerpt || null;
      insert.video_title = v.kind === "text" ? "Text capture" : "Image";
      insert.source_metadata = v.metadata;
      if (v.content) {
        try {
          const { data: tagRows } = await supabase
            .from("clips")
            .select("tags")
            .eq("user_id", userId)
            .is("deleted_at", null)
            .limit(500);
          const existingTags = [
            ...new Set((tagRows ?? []).flatMap((r) => (r.tags as string[]) ?? [])),
          ];
          const e = await enrichClip({ sourceType: "image", text: v.content, existingTags });
          insert.category = e.category;
          insert.tags = e.tags;
          insert.summary_json = { summary: e.summary, keyPoints: [], timestamps: [] };
        } catch {
          // leave unenriched
        }
      }
    } catch (err) {
      insert.status = "failed";
      insert.error_message = err instanceof Error ? err.message : "Vision failed";
    }

    const { data: row, error } = await supabase.from("clips").insert(insert).select("*").single();
    if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
    const clip = toClip(row);
    clip.heroImageUrl = (await signImageUrl(body.imagePath)) ?? clip.heroImageUrl;
    return c.json({ clip }, 201);
  }

  if (!body.url) return c.json({ error: "url is required" }, 400);

  const sourceType = detectSourceType(body.url);

  // YouTube → the summarize pipeline (same path as POST /queue), so share-sheet,
  // capture-sheet and API-key clients get a real summary, not a bare link.
  // Dedup/rate limits are the queue's (windowed per video), not per-URL below.
  if (sourceType === "youtube") {
    const result = await enqueueVideo({ userId, videoUrl: body.url });
    if (!result.ok) return c.json(result.body, result.status);
    return c.json({ clip: toClip(result.row) }, 201);
  }

  // Dedup: one non-deleted clip per (user, url).
  const { data: existing } = await supabase
    .from("clips")
    .select("id")
    .eq("user_id", userId)
    .eq("source_url", body.url)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return c.json({ error: "DUPLICATE", message: "Clip already saved" }, 409);

  // Bookmark tier: head-only metadata, no Readability, no Claude. Still
  // embedded below, or the bookmark would be invisible to semantic search.
  if (body.tier === "metadata") {
    let md: Awaited<ReturnType<typeof extractWebMetadata>>;
    try {
      md = await extractWebMetadata(body.url);
    } catch {
      md = { title: body.url };
    }
    const { data: row, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: sourceType,
        source_url: body.url,
        enrichment_tier: "metadata",
        ...(userNote && { user_notes: userNote }),
        video_title: md.title,
        hero_image_url: md.heroImageUrl ?? null,
        source_metadata: { siteName: md.siteName, faviconUrl: md.faviconUrl },
        status: "completed",
        tags: [],
      })
      .select("*")
      .single();
    if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
    await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id } });
    return c.json({ clip: toClip(row) }, 201);
  }

  // Build the insert payload from whichever extractor matches.
  const insert: Record<string, unknown> = {
    user_id: userId,
    source_type: sourceType,
    source_url: body.url,
    tags: [],
    ...(userNote && { user_notes: userNote }),
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
      // Other types (e.g. podcast) have no extractor on this path yet;
      // save a bare link so nothing is lost. YouTube is routed to the queue above.
      insert.status = "completed";
    }
  } catch (err) {
    insert.status = "failed";
    insert.error_message = err instanceof Error ? err.message : "Extraction failed";
    insert.video_title = body.url;
  }

  // Enrich synchronously (summary/tags/category) so the inbox is populated
  // reliably at capture time, independent of the async embedding worker.
  // Best-effort: a failure here never blocks saving the clip.
  if (
    insert.status === "completed" &&
    (sourceType === "web" || sourceType === "tweet") &&
    typeof insert.content === "string" &&
    insert.content
  ) {
    try {
      const { data: tagRows } = await supabase
        .from("clips")
        .select("tags")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .limit(500);
      const existingTags = [...new Set((tagRows ?? []).flatMap((r) => (r.tags as string[]) ?? []))];
      const e = await enrichClip({
        sourceType,
        title: insert.video_title as string | undefined,
        text: insert.content,
        existingTags,
      });
      insert.category = e.category;
      insert.tags = e.tags;
      insert.summary_json = { summary: e.summary, keyPoints: [], timestamps: [] };
    } catch {
      // leave unenriched — the embed worker (or a backfill) can retry later
    }
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
