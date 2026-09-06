import type { Summary } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { resolveClipImage } from "../lib/storage.js";

export async function findRelatedClips(
  clipId: string,
  userId: string,
  limit = 5,
): Promise<Summary[]> {
  const { data: src, error: srcErr } = await supabase
    .from("clips")
    .select("embedding")
    .eq("id", clipId)
    .single();
  if (srcErr || !src?.embedding) return [];

  const { data: matches, error: rpcErr } = await supabase.rpc("match_clips", {
    query_embedding: src.embedding,
    match_user_id: userId,
    exclude_id: clipId,
    match_count: limit,
  });
  if (rpcErr || !matches?.length) return [];

  const ids = (matches as { id: string }[]).map((m) => m.id);
  const { data: rows, error: rowsErr } = await supabase.from("clips").select("*").in("id", ids);
  if (rowsErr || !rows) return [];

  const order = new Map(ids.map((id, i) => [id, i]));
  const clips = await Promise.all(
    rows.map((r) => resolveClipImage(toClip(r as Record<string, unknown>))),
  );
  return clips.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
