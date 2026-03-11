import Anthropic from "@anthropic-ai/sdk";
import type { SummaryJson } from "@cliphy/shared";
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

export async function suggestTags(
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

export async function suggestTagsBulk(
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
