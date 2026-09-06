import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { generateEmbedding } from "../services/embedding.js";
import { enrichClip } from "../services/enrich.js";
import type { Summary } from "@cliphy/shared";

type ClipRow = {
  source_type: string;
  author: string | null;
  content: string | null;
  summary_json?: Summary["summaryJson"] | null;
  video_title?: string | null;
};

export function buildEmbedText(clip: ClipRow): string {
  if (clip.source_type === "tweet") {
    return `${clip.author ?? ""}: ${clip.content ?? ""}`.trim();
  }
  const sj = clip.summary_json;
  const keyPoints = sj?.keyPoints?.join(" ") ?? "";
  return `${sj?.summary ?? ""} ${keyPoints}`.trim();
}

export const embedClip = inngest.createFunction(
  { id: "embed-clip", retries: 3, triggers: [{ event: "clip/embed.requested" }] },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, source_type, content, summary_json, author, category, tags, video_title")
        .eq("id", clipId)
        .single();
      if (error) throw new Error(`Failed to fetch clip ${clipId}: ${error.message}`);
      return data as ClipRow & { id: string };
    });

    // Web/tweet clips arrive without a summary — enrich them (summary, tags,
    // category) before embedding so the embed text and inbox are populated.
    if (
      (clip.source_type === "web" ||
        clip.source_type === "tweet" ||
        clip.source_type === "image") &&
      !clip.summary_json
    ) {
      const enrichment = await step.run("enrich-clip", async () => {
        const e = await enrichClip({
          sourceType: clip.source_type as "web" | "tweet" | "image",
          title: clip.video_title ?? undefined,
          text: clip.content ?? "",
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

    await step.run("store-embedding", async () => {
      const embedText = buildEmbedText(clip);
      const embedding = await generateEmbedding(embedText);
      const { error } = await supabase.from("clips").update({ embedding }).eq("id", clipId);
      if (error) throw new Error(`Failed to store embedding for ${clipId}: ${error.message}`);
    });

    return { clipId, status: "embedded" };
  },
);
