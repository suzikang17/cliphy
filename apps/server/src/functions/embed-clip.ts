import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { generateEmbedding } from "../services/embedding.js";
import { enrichClip } from "../services/enrich.js";
import type { Summary } from "@cliphy/shared";

const log = logger.child({ fn: "embed-clip" });

type ClipRow = {
  source_type: string;
  enrichment_tier?: string;
  author: string | null;
  content: string | null;
  summary_json?: Summary["summaryJson"] | null;
  video_title?: string | null;
  user_id?: string;
};

export function buildEmbedText(clip: ClipRow): string {
  if (clip.source_type === "tweet") {
    return `${clip.author ?? ""}: ${clip.content ?? ""}`.trim();
  }
  const sj = clip.summary_json;
  const keyPoints = sj?.keyPoints?.join(" ") ?? "";
  const fromSummary = `${sj?.summary ?? ""} ${keyPoints}`.trim();
  if (fromSummary) return fromSummary;
  // Bookmark-tier clips never get a Claude pass, so there is no summary to
  // embed. Fall back to the title — embedding the empty string would produce a
  // meaningless vector and quietly make every bookmark unsearchable.
  return (clip.video_title ?? "").trim();
}

export const embedClip = inngest.createFunction(
  { id: "embed-clip", retries: 3, triggers: [{ event: "clip/embed.requested" }] },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select(
          "id, source_type, content, summary_json, author, category, tags, video_title, user_id, enrichment_tier",
        )
        .eq("id", clipId)
        .single();
      if (error) throw new Error(`Failed to fetch clip ${clipId}: ${error.message}`);
      return data as ClipRow & { id: string };
    });

    // Web/tweet clips arrive without a summary — enrich them (summary, tags,
    // category) before embedding so the embed text and inbox are populated.
    // Bookmark-tier clips get an embedding but never a Claude pass — that is
    // the whole point of the metadata tier. Removing this guard silently
    // re-introduces a summarization cost on every pinned site.
    if (
      clip.enrichment_tier !== "metadata" &&
      (clip.source_type === "web" ||
        clip.source_type === "tweet" ||
        clip.source_type === "image") &&
      !clip.summary_json
    ) {
      const enrichment = await step.run("enrich-clip", async () => {
        const existingTags = await (async () => {
          const { data } = await supabase
            .from("clips")
            .select("tags")
            .eq("user_id", clip.user_id ?? "")
            .is("deleted_at", null)
            .limit(500);
          const set = new Set<string>();
          for (const row of data ?? []) for (const t of (row.tags as string[]) ?? []) set.add(t);
          return [...set];
        })();
        const e = await enrichClip({
          sourceType: clip.source_type as "web" | "tweet" | "image",
          title: clip.video_title ?? undefined,
          text: clip.content ?? "",
          existingTags,
        });
        const summaryJson = { summary: e.summary, keyPoints: [], timestamps: [] };
        const { error } = await supabase
          .from("clips")
          .update({ category: e.category, tags: e.tags, summary_json: summaryJson })
          .eq("id", clipId);
        if (error) throw new Error(`Failed to enrich ${clipId}: ${error.message}`);
        return e;
      });
      // Keep the in-memory row in sync so buildEmbedText sees the fresh summary.
      clip.summary_json = { summary: enrichment.summary, keyPoints: [], timestamps: [] };
    }

    // Embedding only powers semantic search + related-clips; it must not sink the
    // enrichment above. If it fails (e.g. VOYAGE_API_KEY unset), log and move on so
    // the clip still lands enriched — search/related just degrade until it's fixed.
    const embedded = await step.run("store-embedding", async () => {
      try {
        const embedText = buildEmbedText(clip);
        const embedding = await generateEmbedding(embedText);
        const { error } = await supabase.from("clips").update({ embedding }).eq("id", clipId);
        if (error) throw new Error(error.message);
        return true;
      } catch (err) {
        log.warn("Embedding skipped", { clipId, error: (err as Error).message });
        return false;
      }
    });

    return { clipId, status: embedded ? "embedded" : "enriched-no-embedding" };
  },
);
