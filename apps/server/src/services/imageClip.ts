import { supabase } from "../lib/supabase.js";
import { runImageVision } from "./processImage.js";
import { enrichClip } from "./enrich.js";

/**
 * Save an uploaded image as a clip: run vision synchronously (reliable, no
 * worker dependency) so OCR/description + enrichment land at capture time.
 * `extraTags` are applied whatever vision or enrichment do (e.g. a project tag).
 * Returns the inserted row. Throws only when the clip itself cannot be saved.
 */
export async function createImageClip(
  userId: string,
  storagePath: string,
  extraTags: string[],
): Promise<Record<string, unknown>> {
  const insert: Record<string, unknown> = {
    user_id: userId,
    source_type: "image",
    hero_image_url: storagePath,
    source_metadata: { storagePath },
    status: "completed",
    tags: [...extraTags],
  };
  try {
    const v = await runImageVision(storagePath);
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
          ...new Set(((tagRows as { tags: string[] | null }[]) ?? []).flatMap((r) => r.tags ?? [])),
        ];
        const e = await enrichClip({ sourceType: "image", text: v.content, existingTags });
        insert.category = e.category;
        insert.tags = [...new Set([...extraTags, ...e.tags])];
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
  if (error || !row) throw new Error("Failed to save clip");
  return row as Record<string, unknown>;
}
