import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { generateEmbedding } from "../services/embedding.js";
import type { Summary } from "@cliphy/shared";

type ClipRow = {
  source_type: string;
  author: string | null;
  content: string | null;
  summary_json?: Summary["summaryJson"] | null;
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
        .select("id, source_type, content, summary_json, author")
        .eq("id", clipId)
        .single();
      if (error) throw new Error(`Failed to fetch clip ${clipId}: ${error.message}`);
      return data as ClipRow & { id: string };
    });

    await step.run("store-embedding", async () => {
      const embedText = buildEmbedText(clip);
      const embedding = await generateEmbedding(embedText);
      const { error } = await supabase.from("clips").update({ embedding }).eq("id", clipId);
      if (error) throw new Error(`Failed to store embedding for ${clipId}: ${error.message}`);
    });

    return { clipId, status: "embedded" };
  },
);
