import Anthropic from "@anthropic-ai/sdk";
import { MAX_TAGS_PER_SUMMARY, type SummaryJson } from "@cliphy/shared";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { isTaggerConfigured, mergeTags, rankTags, tagClip } from "./tagger.js";
import {
  TAG_SUGGESTION_SYSTEM_PROMPT,
  BULK_TAG_SUGGESTION_SYSTEM_PROMPT,
  tagSuggestionUserPrompt,
  bulkTagSuggestionUserPrompt,
} from "../lib/prompts.js";

const anthropic = new Anthropic({ timeout: 30_000 });
const MODEL = "claude-haiku-4-5-20251001";

interface TagSuggestionResult {
  existing: string[];
  new: string[];
}

interface BulkTagSuggestionResult {
  id: string;
  existing: string[];
  new: string[];
}

const log = logger.child({ service: "auto-tag" });

// Claude-only tag suggestion — used to generate candidate *new* tags for clips summarized
// before summaryJson.topics existed, and as the whole path when Jev isn't configured.
async function claudeSuggestTags(
  summaryJson: SummaryJson,
  existingTags: string[],
): Promise<TagSuggestionResult> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    temperature: 0,
    system: TAG_SUGGESTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: tagSuggestionUserPrompt(
          summaryJson.summary,
          summaryJson.keyPoints,
          summaryJson.contextSection?.title ?? null,
          existingTags,
        ),
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(text.replace(/```json?\n?|```/g, ""));

  return {
    existing: Array.isArray(parsed.existing)
      ? parsed.existing.filter((t: unknown) => typeof t === "string" && existingTags.includes(t))
      : [],
    new: Array.isArray(parsed.new)
      ? parsed.new
          .filter((t: unknown) => typeof t === "string" && !existingTags.includes(t as string))
          .map((t: string) => t.toLowerCase().trim())
          .slice(0, 2)
      : [],
  };
}

async function claudeSuggestTagsBulk(
  videos: { id: string; summaryJson: SummaryJson }[],
  existingTags: string[],
): Promise<BulkTagSuggestionResult[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: BULK_TAG_SUGGESTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: bulkTagSuggestionUserPrompt(
          videos.map((v) => ({
            id: v.id,
            summary: v.summaryJson.summary,
            keyPoints: v.summaryJson.keyPoints,
            contextTitle: v.summaryJson.contextSection?.title ?? null,
          })),
          existingTags,
        ),
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(text.replace(/```json?\n?|```/g, ""));

  const results: BulkTagSuggestionResult[] = [];
  const items = Array.isArray(parsed.results) ? parsed.results : [];

  for (const item of items) {
    if (typeof item.id !== "string") continue;
    results.push({
      id: item.id,
      existing: Array.isArray(item.existing)
        ? item.existing.filter((t: unknown) => typeof t === "string" && existingTags.includes(t))
        : [],
      new: Array.isArray(item.new)
        ? item.new
            .filter((t: unknown) => typeof t === "string" && !existingTags.includes(t as string))
            .map((t: string) => t.toLowerCase().trim())
            .slice(0, 2)
        : [],
    });
  }

  return results;
}

/**
 * Suggest tags for one clip: Jev picks which existing tags apply; candidates for new
 * tags come from summaryJson.topics (or Claude, for older summaries without topics).
 */
export async function suggestTags(
  summaryJson: SummaryJson,
  existingTags: string[],
): Promise<TagSuggestionResult> {
  if (!isTaggerConfigured()) return claudeSuggestTags(summaryJson, existingTags);

  const candidates = summaryJson.topics?.length
    ? summaryJson.topics
    : (await claudeSuggestTags(summaryJson, existingTags)).new;
  const { apply, suggest } = await tagClip({ summaryJson, existingTags, candidates });
  return { existing: apply, new: suggest };
}

export async function suggestTagsBulk(
  videos: { id: string; summaryJson: SummaryJson }[],
  existingTags: string[],
): Promise<BulkTagSuggestionResult[]> {
  if (!isTaggerConfigured()) return claudeSuggestTagsBulk(videos, existingTags);

  // One Claude call covers every clip that predates topics
  const needCandidates = videos.filter((v) => !v.summaryJson.topics?.length);
  const claudeNew = new Map<string, string[]>();
  if (needCandidates.length > 0) {
    for (const r of await claudeSuggestTagsBulk(needCandidates, existingTags)) {
      claudeNew.set(r.id, r.new);
    }
  }

  return Promise.all(
    videos.map(async (v) => {
      const candidates = v.summaryJson.topics?.length
        ? v.summaryJson.topics
        : (claudeNew.get(v.id) ?? []);
      const { apply, suggest } = await tagClip({
        summaryJson: v.summaryJson,
        existingTags,
        candidates,
      });
      return { id: v.id, existing: apply, new: suggest };
    }),
  );
}

/**
 * Pipeline step: after a summary completes, auto-apply matching existing tags and
 * store unmatched topics as suggestions. Returns what changed (for step output/logs).
 */
export async function autoTagClip(
  clipId: string,
): Promise<{ applied: string[]; suggested: string[]; skipped?: string }> {
  const { data: clip } = await supabase
    .from("clips")
    .select("user_id, tags, summary_json, video_title")
    .eq("id", clipId)
    .single();

  const summaryJson = clip?.summary_json as SummaryJson | null | undefined;
  if (!clip || !summaryJson) return { applied: [], suggested: [], skipped: "no_summary" };

  const { data: rows } = await supabase
    .from("clips")
    .select("tags")
    .eq("user_id", clip.user_id)
    .is("deleted_at", null);
  const existingTags = rankTags(rows ?? []);

  if (existingTags.length > 0 && !isTaggerConfigured()) {
    log.warn("TYPESAFE_API_KEY not set — skipping auto-tag", { clipId });
    return { applied: [], suggested: [], skipped: "not_configured" };
  }

  const { apply, suggest } = await tagClip({
    summaryJson,
    title: (clip.video_title as string | null) ?? undefined,
    existingTags,
    candidates: summaryJson.topics ?? [],
  });

  const current = (clip.tags as string[] | null) ?? [];
  const tags = mergeTags(current, apply, MAX_TAGS_PER_SUMMARY);
  const suggested = suggest.filter((t) => !tags.includes(t));

  await supabase.from("clips").update({ tags, suggested_tags: suggested }).eq("id", clipId);

  return { applied: tags.filter((t) => !current.includes(t)), suggested };
}
