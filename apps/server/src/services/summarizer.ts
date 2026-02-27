import Anthropic from "@anthropic-ai/sdk";
import type { SummaryJson } from "@cliphy/shared";
import { SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT } from "../lib/prompts.js";

const anthropic = new Anthropic();

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;

const MAX_SUMMARY_LENGTH = 1000;
const MAX_ITEM_LENGTH = 500;
const MAX_ARRAY_ITEMS = 50;

/** Filter to only string elements, truncate, and cap array length. */
function sanitizeStringArray(arr: unknown[], maxItems = MAX_ARRAY_ITEMS): string[] {
  return arr
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((s) => s.slice(0, MAX_ITEM_LENGTH));
}

/** Extract and validate JSON from Claude's response text. */
export function parseSummaryResponse(text: string): SummaryJson {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse summary response as JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Failed to parse summary: expected a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.summary !== "string" ||
    !Array.isArray(obj.keyPoints) ||
    !Array.isArray(obj.timestamps)
  ) {
    throw new Error("Failed to parse summary: missing required fields");
  }

  return {
    summary: obj.summary.slice(0, MAX_SUMMARY_LENGTH),
    keyPoints: sanitizeStringArray(obj.keyPoints),
    actionItems: Array.isArray(obj.actionItems) ? sanitizeStringArray(obj.actionItems) : [],
    timestamps: sanitizeStringArray(obj.timestamps),
  };
}

export async function summarizeTranscript(
  transcript: string,
  videoTitle: string,
): Promise<SummaryJson> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: SUMMARY_USER_PROMPT(videoTitle, transcript),
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    return parseSummaryResponse(text);
  } catch {
    // Retry once with stricter instruction
    const retry = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: SUMMARY_USER_PROMPT(videoTitle, transcript),
        },
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "Your response was not valid JSON. Please respond with ONLY a valid JSON object matching the schema. No markdown, no explanation.",
        },
      ],
    });

    const retryText = retry.content[0].type === "text" ? retry.content[0].text : "";
    return parseSummaryResponse(retryText);
  }
}
