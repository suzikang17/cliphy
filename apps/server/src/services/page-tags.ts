import { normalizeUrl, type TabAssignment } from "@cliphy/shared";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";

// page_tags: which group each page belongs to, per user. The AI's answer and
// your manual choice are separate columns so undoing a manual move falls back
// to the AI. Lets organize skip AI for pages it has already sorted (on any
// device), and lets the Trail / ⌘⇧S reuse a page's tag.

const log = logger.child({ service: "page-tags" });

/** Reuse a stored AI tag for this long before re-classifying. */
export const TAG_TTL_MS = 30 * 86_400_000;
/** "Fits nothing" goes stale fast — new tags/keywords may fit it tomorrow. */
export const NONE_TTL_MS = 86_400_000;

export type AiSource = "keyword" | "jev" | "claude";

export interface PageTagRow {
  url: string;
  ai_kind: "tag" | "proposed" | "none" | null;
  ai_value: string | null;
  ai_source: AiSource | null;
  ai_at: string | null;
  done: boolean;
  override: string | null;
}

export const pageKey = (url: string) => normalizeUrl(url) ?? url;

export async function loadPageTags(
  userId: string,
  urls: string[],
): Promise<Map<string, PageTagRow>> {
  const keys = [...new Set(urls.map(pageKey))];
  if (keys.length === 0) return new Map();
  const { data, error } = await supabase
    .from("page_tags")
    .select("url, ai_kind, ai_value, ai_source, ai_at, done, override")
    .eq("user_id", userId)
    .in("url", keys);
  if (error) {
    log.warn("page_tags load failed", { code: error.code });
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.url as string, r as PageTagRow]));
}

/** The stored AI answer, if still fresh enough to reuse. */
export function reusableAssignment(row: PageTagRow, now = Date.now()): TabAssignment | null {
  if (!row.ai_kind || !row.ai_at) return null;
  const age = now - Date.parse(row.ai_at);
  if (row.ai_kind === "none") return age <= NONE_TTL_MS ? { none: true } : null;
  if (age > TAG_TTL_MS || !row.ai_value) return null;
  return row.ai_kind === "tag" ? { tag: row.ai_value } : { proposed: row.ai_value };
}

/** Save fresh AI answers; never touches your manual override. */
export async function saveAiAssignments(
  userId: string,
  entries: { url: string; assignment: TabAssignment; source: AiSource | null; done: boolean }[],
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const rows = entries.map(({ url, assignment, source, done }) => ({
    user_id: userId,
    url: pageKey(url),
    ai_kind: "tag" in assignment ? "tag" : "proposed" in assignment ? "proposed" : "none",
    ai_value:
      "tag" in assignment ? assignment.tag : "proposed" in assignment ? assignment.proposed : null,
    ai_source: source,
    ai_at: now,
    done,
    updated_at: now,
  }));
  // One row per page even if two tabs in the batch show it.
  const unique = [...new Map(rows.map((r) => [r.url, r])).values()];
  const { error } = await supabase.from("page_tags").upsert(unique, { onConflict: "user_id,url" });
  if (error) log.warn("page_tags save failed", { code: error.code });
}

/** Save (or clear, with null) your manual group choice for pages. */
export async function setOverrides(
  userId: string,
  items: { url: string; override: string | null }[],
): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  const rows = [
    ...new Map(
      items.map((i) => [
        pageKey(i.url),
        { user_id: userId, url: pageKey(i.url), override: i.override, updated_at: now },
      ]),
    ).values(),
  ];
  const { error } = await supabase.from("page_tags").upsert(rows, { onConflict: "user_id,url" });
  if (error) throw new Error("Failed to save page overrides");
}

/** "＋ Save as tag" on a suggested group: every page proposed as `name` now has tag `tag`. */
export async function promoteProposal(userId: string, name: string, tag: string): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    supabase
      .from("page_tags")
      .update({ ai_kind: "tag", ai_value: tag, updated_at: now })
      .eq("user_id", userId)
      .eq("ai_kind", "proposed")
      .eq("ai_value", name),
    supabase
      .from("page_tags")
      .update({ override: `tag:${tag}`, updated_at: now })
      .eq("user_id", userId)
      .eq("override", `proposed:${name}`),
  ]);
}

/** A page's tag (your choice first, then the AI's), for the Trail and ⌘⇧S. */
export async function tagsForPages(userId: string, urls: string[]): Promise<Map<string, string>> {
  const rows = await loadPageTags(userId, urls);
  const out = new Map<string, string>();
  for (const url of urls) {
    const row = rows.get(pageKey(url));
    if (!row) continue;
    if (row.override?.startsWith("tag:")) out.set(url, row.override.slice(4));
    else if (!row.override && row.ai_kind === "tag" && row.ai_value) out.set(url, row.ai_value);
  }
  return out;
}
