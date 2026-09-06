import type { Summary } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { generateEmbedding } from "./embedding.js";
import { resolveClipImage } from "../lib/storage.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function semanticSearch(
  userId: string,
  query: string,
  limit: number,
): Promise<Summary[]> {
  const embedding = await generateEmbedding(query);
  const { data: matches, error } = await supabase.rpc("match_clips", {
    query_embedding: embedding,
    match_user_id: userId,
    exclude_id: NIL_UUID,
    match_count: limit,
  });
  if (error || !matches?.length) return [];
  const ids = (matches as { id: string }[]).map((m) => m.id);
  const { data: rows } = await supabase.from("clips").select("*").in("id", ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  const clips = await Promise.all(
    (rows ?? []).map((r) => resolveClipImage(toClip(r as Record<string, unknown>))),
  );
  return clips.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
