import type { Summary, ViewQuery, SourceType, ClipCategory } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { resolveClipImage } from "../lib/storage.js";
import { semanticSearch } from "./search.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const SOURCE_TYPES: SourceType[] = ["youtube", "tweet", "podcast", "web", "image"];

/**
 * Coerce user-authored JSON into a ViewQuery. This is the security boundary:
 * view_query comes from the client and becomes a database query, so only known
 * fields with the right types survive. Everything else is dropped silently.
 */
export function sanitizeViewQuery(input: unknown): ViewQuery {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: ViewQuery = {};

  if (typeof raw.semantic === "string" && raw.semantic.trim()) out.semantic = raw.semantic.trim();
  if (typeof raw.search === "string" && raw.search.trim()) out.search = raw.search.trim();
  if (typeof raw.author === "string" && raw.author.trim()) out.author = raw.author.trim();
  if (typeof raw.category === "string") out.category = raw.category as ClipCategory;

  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tags.length) out.tags = tags;
  }

  if (Array.isArray(raw.sourceType)) {
    const types = raw.sourceType.filter(
      (t): t is SourceType => typeof t === "string" && (SOURCE_TYPES as string[]).includes(t),
    );
    if (types.length) out.sourceType = types;
  }

  const limit = typeof raw.limit === "number" && Number.isFinite(raw.limit) ? raw.limit : NaN;
  out.limit =
    Number.isNaN(limit) || limit <= 0 ? DEFAULT_LIMIT : Math.min(Math.floor(limit), MAX_LIMIT);

  return out;
}

/** Run a sanitized view and return the clips it selects, newest first. */
export async function runViewQuery(userId: string, view: ViewQuery): Promise<Summary[]> {
  const limit = view.limit ?? DEFAULT_LIMIT;

  // A semantic term wins: embedding search already ranks and limits.
  if (view.semantic) return semanticSearch(userId, view.semantic, limit);

  let query = supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("archived_at", null);

  if (view.tags?.length) query = query.overlaps("tags", view.tags);
  if (view.sourceType?.length) query = query.in("source_type", view.sourceType);
  if (view.category) query = query.eq("category", view.category);
  if (view.author) query = query.eq("author", view.author);
  if (view.search) {
    query = query.or(`video_title.ilike.%${view.search}%,excerpt.ilike.%${view.search}%`);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];

  return Promise.all((data as Record<string, unknown>[]).map((r) => resolveClipImage(toClip(r))));
}
