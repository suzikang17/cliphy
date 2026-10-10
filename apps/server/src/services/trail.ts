import {
  MAX_TAGS_PER_SUMMARY,
  matchAllKeywordTags,
  type TrailCaptureItem,
  type TrailItem,
} from "@cliphy/shared";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { isTaggerConfigured, mergeTags, rankTags, tagClip } from "./tagger.js";

// Trail: pages the user closed, captured by the extension (opt-in). Kept apart
// from clips — one row per URL — and auto-tagged on first capture with the same
// cheap path as ⌘⇧S (keywords + Jev; no Claude, no page reading).

const log = logger.child({ service: "trail" });

export const MAX_CAPTURE_BATCH = 50;
export const RETENTION_CHOICES = [7, 30, 90, 365] as const;
const JEV_CONCURRENCY = 8;

export function toTrailItem(row: Record<string, unknown>): TrailItem {
  return {
    id: row.id as string,
    url: row.url as string,
    title: (row.title as string) ?? "",
    host: (row.host as string) ?? "",
    tags: (row.tags as string[]) ?? [],
    openedAt: (row.opened_at as string) ?? undefined,
    closedAt: row.closed_at as string,
    closeCount: (row.close_count as number) ?? 1,
    ...(row.custom_title ? { customTitle: row.custom_title as string } : {}),
    ...(row.note ? { note: row.note as string } : {}),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Save a batch of closed pages. Returns how many rows were inserted or bumped. */
export async function captureTrail(userId: string, raw: TrailCaptureItem[]): Promise<number> {
  // Latest close wins within a batch.
  const byUrl = new Map<string, TrailCaptureItem>();
  for (const item of raw) {
    const prev = byUrl.get(item.url);
    if (!prev || item.closedAt > prev.closedAt) byUrl.set(item.url, item);
  }
  const urls = [...byUrl.keys()];
  if (urls.length === 0) return 0;

  const [{ data: savedClips }, { data: existing }] = await Promise.all([
    supabase
      .from("clips")
      .select("source_url")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("source_url", urls),
    supabase
      .from("trail_items")
      .select("id, url, close_count")
      .eq("user_id", userId)
      .in("url", urls),
  ]);
  // Already a clip → it's kept; no need for a trail entry.
  const inClips = new Set((savedClips ?? []).map((r) => r.source_url as string));
  const known = new Map((existing ?? []).map((r) => [r.url as string, r]));

  let count = 0;
  const fresh: TrailCaptureItem[] = [];
  for (const item of byUrl.values()) {
    if (inClips.has(item.url)) continue;
    const row = known.get(item.url);
    if (row) {
      const { error } = await supabase
        .from("trail_items")
        .update({
          title: item.title.slice(0, 500),
          closed_at: iso(item.closedAt),
          close_count: ((row.close_count as number) ?? 1) + 1,
          // Only overwrite your name/note when the tab carried one.
          ...(item.customTitle !== undefined && { custom_title: item.customTitle || null }),
          ...(item.note !== undefined && { note: item.note || null }),
        })
        .eq("id", row.id as string);
      if (!error) count++;
    } else {
      fresh.push(item);
    }
  }
  if (fresh.length === 0) return count;

  const tags = await tagFresh(userId, fresh);
  const { error } = await supabase.from("trail_items").insert(
    fresh.map((item, i) => ({
      user_id: userId,
      url: item.url,
      title: item.title.slice(0, 500),
      host: hostOf(item.url),
      tags: tags[i],
      opened_at: item.openedAt ? iso(item.openedAt) : null,
      closed_at: iso(item.closedAt),
      custom_title: item.customTitle || null,
      note: item.note || null,
    })),
  );
  if (error) {
    log.warn("Trail insert failed", { code: error.code });
    return count;
  }
  return count + fresh.length;
}

async function tagFresh(userId: string, items: TrailCaptureItem[]): Promise<string[][]> {
  const [{ data: rows }, { data: hintRows }] = await Promise.all([
    supabase.from("clips").select("tags").eq("user_id", userId).is("deleted_at", null),
    supabase.from("tag_hints").select("tag, keywords").eq("user_id", userId),
  ]);
  const keywords: Record<string, string[]> = {};
  for (const r of hintRows ?? []) {
    const kws = (r.keywords as string[] | null) ?? [];
    if (kws.length) keywords[r.tag as string] = kws;
  }
  const ranked = rankTags(rows ?? []);
  const vocab = [...ranked, ...Object.keys(keywords).filter((t) => !ranked.includes(t))];
  const useJev = isTaggerConfigured() && vocab.length > 0;

  const out: string[][] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const { url } = items[i];
      const title = [items[i].customTitle, items[i].title].filter(Boolean).join(" — ");
      const kw = matchAllKeywordTags({ url, title }, keywords);
      let jev: string[] = [];
      if (useJev) {
        try {
          jev = (
            await tagClip({
              summaryJson: { summary: `${title} — ${url}`, keyPoints: [], timestamps: [] },
              title,
              existingTags: vocab,
              candidates: [],
            })
          ).apply;
        } catch (err) {
          log.warn("Jev trail tagging failed", { error: (err as Error).message });
        }
      }
      out[i] = mergeTags(kw, jev, MAX_TAGS_PER_SUMMARY);
    }
  }
  await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, items.length) }, worker));
  return out;
}

/** Characters that would break PostgREST's or()/ilike filter syntax. */
const sanitize = (q: string) => q.replace(/[,()%*\\]/g, " ").trim();

export async function listTrail(
  userId: string,
  opts: { q?: string; before?: string; limit: number },
): Promise<{ items: TrailItem[]; nextBefore?: string }> {
  let query = supabase
    .from("trail_items")
    .select("*")
    .eq("user_id", userId)
    .order("closed_at", { ascending: false })
    .limit(opts.limit + 1);
  if (opts.before) query = query.lt("closed_at", opts.before);
  const q = opts.q ? sanitize(opts.q) : "";
  if (q) {
    const tag = q.toLowerCase().replace(/[{}"]/g, "");
    query = query.or(
      `title.ilike.%${q}%,url.ilike.%${q}%,custom_title.ilike.%${q}%,note.ilike.%${q}%,tags.cs.{"${tag}"}`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error("Failed to list trail");
  const rows = data ?? [];
  const items = rows.slice(0, opts.limit).map(toTrailItem);
  return rows.length > opts.limit ? { items, nextBefore: items.at(-1)?.closedAt } : { items };
}

export async function getTrailItem(userId: string, id: string) {
  const { data } = await supabase
    .from("trail_items")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? toTrailItem(data) : null;
}

export async function deleteTrailItem(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("trail_items")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

export async function getRetentionDays(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from("user_settings")
    .select("trail_retention_days")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.trail_retention_days as number | null) ?? null;
}

export async function setRetentionDays(userId: string, days: number | null): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, trail_retention_days: days }, { onConflict: "user_id" });
  if (error) throw new Error("Failed to save trail settings");
}

/** Daily cleanup: delete entries older than each user's retention (null = forever). */
export async function purgeExpiredTrail(now = Date.now()): Promise<number> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("user_id, trail_retention_days")
    .not("trail_retention_days", "is", null);
  let deleted = 0;
  for (const s of settings ?? []) {
    const days = s.trail_retention_days as number;
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const { data } = await supabase
      .from("trail_items")
      .delete()
      .eq("user_id", s.user_id as string)
      .lt("closed_at", cutoff)
      .select("id");
    deleted += data?.length ?? 0;
  }
  return deleted;
}
