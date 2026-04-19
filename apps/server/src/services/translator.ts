import Anthropic from "@anthropic-ai/sdk";
import type { SummaryJson } from "@cliphy/shared";
import { parseSummaryResponse } from "./summarizer.js";

const anthropic = new Anthropic({ timeout: 60_000 });

export async function translateSummaryJson(
  summaryJson: SummaryJson,
  targetLanguageName: string,
): Promise<SummaryJson> {
  const prompt = `Translate this video summary JSON into ${targetLanguageName}.

Rules:
- Translate all text values (summary, keyPoints, timestamps labels, contextSection title/items/groups)
- For timestamps like "[1:23] Some label", preserve the "[1:23]" marker exactly and only translate the label text after it
- Keep the exact JSON structure and keys unchanged
- Respond with ONLY the translated JSON object, no markdown fences or explanation

${JSON.stringify(summaryJson, null, 2)}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseSummaryResponse(text);
}
