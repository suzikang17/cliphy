import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import { detectSourceType } from "../services/detectSourceType.js";
import { extractWebMetadata } from "../services/extractors/webMetadata.js";
import { signImageUrl } from "../lib/storage.js";
import { findRelatedClips } from "../services/related.js";
import { createImageClip } from "../services/imageClip.js";
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

  // Image capture: vision + enrichment run at capture time (see createImageClip).
  if (body.imagePath) {
    let row: Record<string, unknown>;
    try {
      row = await createImageClip(userId, body.imagePath, []);
    } catch {
      return c.json({ error: "Failed to save clip" }, 500);
    }
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

  // An article or a post: store the bare link and answer at once. Reading
  // the page (extract-clip) and the summary, tags and category (embed-clip)
  // follow in the background, with retries, and the clip fills in live.
  if (sourceType === "web" || sourceType === "tweet") {
    const { data: row, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: sourceType,
        source_url: body.url,
        video_title: body.url,
        status: "processing",
        tags: [],
        ...(userNote && { user_notes: userNote }),
      })
      .select("*")
      .single();
    if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
    await inngest.send({
      id: `extract-${row.id as string}`,
      name: "clip/extract.requested",
      data: { clipId: row.id },
    });
    return c.json({ clip: toClip(row) }, 201);
  }

  // Other types (e.g. podcast) have no extractor on this path yet; save a
  // bare link so nothing is lost. YouTube is routed to the queue above.
  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: sourceType,
      source_url: body.url,
      status: "completed",
      tags: [],
      ...(userNote && { user_notes: userNote }),
    })
    .select("*")
    .single();
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
