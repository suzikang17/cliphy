import Anthropic from "@anthropic-ai/sdk";
import { CLIP_CATEGORIES, type ClipCategory, type SourceType } from "@cliphy/shared";

export interface EnrichInput {
  sourceType: SourceType;
  title?: string;
  text: string;
  existingTags?: string[];
}
export interface Enrichment {
  summary: string;
  tags: string[];
  category: ClipCategory;
}

const anthropic = new Anthropic({ timeout: 30_000 });
const MODEL = "claude-haiku-4-5-20251001";

const VALID_CATEGORIES = new Set<string>(Object.values(CLIP_CATEGORIES));

export function parseEnrichment(raw: string): Enrichment {
  const jsonText = raw.replace(/```json\s*|\s*```/g, "").trim();
  let parsed: { summary?: string; tags?: string[]; category?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
  }
  const category =
    parsed.category && VALID_CATEGORIES.has(parsed.category)
      ? (parsed.category as ClipCategory)
      : "reference";
  return {
    summary: parsed.summary ?? "",
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
    category,
  };
}

export async function enrichClip(input: EnrichInput): Promise<Enrichment> {
  const vocab = input.existingTags?.length
    ? `\n\nPrefer tags from this list when they fit: ${JSON.stringify(
        input.existingTags.slice(0, 100),
      )}. Only invent a new tag when none match.`
    : "";
  const prompt =
    `You triage saved clips. Return ONLY JSON: {"summary": string (<=2 sentences), ` +
    `"tags": string[] (2-4 lowercase topic tags), "category": one of ${JSON.stringify(
      Object.values(CLIP_CATEGORIES),
    )}}.${vocab}\n\n` +
    `Source type: ${input.sourceType}\nTitle: ${input.title ?? ""}\n\nContent:\n${input.text.slice(0, 6000)}`;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  return parseEnrichment(text);
}

/**
 * Whether a saved thing gets a summary, a category and tags now.
 * - "fill": once, when it has none yet (web pages, tweets, images, voice notes).
 * - "refresh": again each time it changes, keeping tags already on it (notes,
 *   which grow as they are added to).
 * - "skip": nothing to read, a bookmark-only save, or a type with its own
 *   pipeline (videos and podcasts are tagged after they are summarized).
 */
export function enrichPlan(clip: {
  source_type?: unknown;
  enrichment_tier?: unknown;
  summary_json?: unknown;
  content?: unknown;
}): "fill" | "refresh" | "skip" {
  const hasWords = typeof clip.content === "string" && clip.content.trim().length > 0;
  if (clip.source_type === "note") return hasWords ? "refresh" : "skip";
  if (clip.source_type === "voice") return hasWords && !clip.summary_json ? "fill" : "skip";
  const read = ["web", "tweet", "image"].includes(clip.source_type as string);
  if (!read || clip.enrichment_tier === "metadata" || clip.summary_json) return "skip";
  return "fill";
}
