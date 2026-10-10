import { MAX_TAGS_PER_SUMMARY, matchAllKeywordTags, type SummaryJson } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { detectSourceType } from "./detectSourceType.js";
import { enqueueVideo } from "./enqueue-video.js";
import { enrichClip } from "./enrich.js";
import { isTaggerConfigured, mergeTags, rankTags, tagClip } from "./tagger.js";
import { tagsForPages } from "./page-tags.js";

// ⌘⇧S "save this page". The extension sends what it already sees (title + page
// text, so logged-in pages work), and we answer fast with the tags applied:
// keywords (deterministic, instant) + Jev over the user's existing tags (~300ms).
// Claude runs only when nothing fits, and its new tags become suggestions.

const log = logger.child({ service: "quick-save" });

export interface QuickSaveInput {
  userId: string;
  url: string;
  title: string;
  description?: string;
  text?: string;
  /** Your note on the page → the clip's notes. */
  note?: string;
}

export type QuickSaveResult =
  | {
      ok: true;
      clip: Record<string, unknown>;
      tags: string[];
      suggestedTags: string[];
      duplicate?: boolean;
      video?: boolean;
    }
  | { ok: false; status: 400 | 409 | 429 | 500; body: Record<string, unknown> };

export async function quickSave(input: QuickSaveInput): Promise<QuickSaveResult> {
  const { userId, url, title } = input;
  const sourceType = detectSourceType(url);

  // Videos go through the summarize pipeline (which auto-tags after summarizing).
  if (sourceType === "youtube") {
    const r = await enqueueVideo({ userId, videoUrl: url, videoTitle: title || undefined });
    if (!r.ok) return r;
    return { ok: true, clip: r.row, tags: [], suggestedTags: [], video: true };
  }

  const { data: existing } = await supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .eq("source_url", url)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      clip: existing,
      tags: (existing.tags as string[]) ?? [],
      suggestedTags: (existing.suggested_tags as string[]) ?? [],
      duplicate: true,
    };
  }

  const [{ data: rows }, { data: hintRows }] = await Promise.all([
    supabase.from("clips").select("tags").eq("user_id", userId).is("deleted_at", null),
    supabase.from("tag_hints").select("tag, keywords").eq("user_id", userId),
  ]);
  const ranked = rankTags(rows ?? []);
  const keywords: Record<string, string[]> = {};
  for (const r of hintRows ?? []) {
    const kws = (r.keywords as string[] | null) ?? [];
    if (kws.length) keywords[r.tag as string] = kws;
  }
  const existingTags = [...ranked, ...Object.keys(keywords).filter((t) => !ranked.includes(t))];

  const text = input.text ?? "";
  // The Tabs view's answer for this page (yours first, then the AI's) is applied before anything else.
  const stored = (await tagsForPages(userId, [url])).get(url);
  const keywordTags = mergeTags(
    stored ? [stored] : [],
    matchAllKeywordTags({ url, title, text }, keywords),
    MAX_TAGS_PER_SUMMARY,
  );

  let jevTags: string[] = [];
  if (isTaggerConfigured() && existingTags.length > 0) {
    const page: SummaryJson = {
      summary: (input.description || text).slice(0, 1500) || title,
      keyPoints: [],
      timestamps: [],
    };
    try {
      jevTags = (await tagClip({ summaryJson: page, title, existingTags, candidates: [] })).apply;
    } catch (err) {
      log.warn("Jev tagging failed", { error: (err as Error).message });
    }
  }
  const tags = mergeTags(keywordTags, jevTags, MAX_TAGS_PER_SUMMARY);

  // Nothing fit → ask Claude, who can name new tags (offered as suggestions).
  let suggestedTags: string[] = [];
  let enrichment: Awaited<ReturnType<typeof enrichClip>> | null = null;
  if (tags.length === 0 && (text || title)) {
    try {
      enrichment = await enrichClip({
        sourceType: sourceType === "tweet" ? "tweet" : "web",
        title,
        text: text || title,
        existingTags,
      });
      const known = new Set(existingTags);
      tags.push(...enrichment.tags.filter((t) => known.has(t)));
      suggestedTags = enrichment.tags.filter((t) => !known.has(t));
    } catch (err) {
      log.warn("Claude enrichment failed", { error: (err as Error).message });
    }
  }

  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: sourceType,
      source_url: url,
      video_title: title || url,
      content: text || null,
      excerpt: (input.description || text).slice(0, 200) || null,
      status: "completed",
      tags,
      suggested_tags: suggestedTags,
      ...(input.note && { user_notes: input.note }),
      ...(enrichment && {
        category: enrichment.category,
        summary_json: { summary: enrichment.summary, keyPoints: [], timestamps: [] },
      }),
    })
    .select("*")
    .single();
  if (error || !row) {
    if (error?.code === "23505") {
      return {
        ok: false,
        status: 409,
        body: { error: "DUPLICATE", message: "Clip already saved" },
      };
    }
    return { ok: false, status: 500, body: { error: "Failed to save clip" } };
  }

  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id } }).catch(() => {});
  log.info("Quick-saved", {
    keywordTags: keywordTags.length,
    jevTags: jevTags.length,
    claude: !!enrichment,
  });
  return { ok: true, clip: row, tags, suggestedTags };
}
