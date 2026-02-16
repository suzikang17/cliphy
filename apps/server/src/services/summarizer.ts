import Anthropic from "@anthropic-ai/sdk";
import { SUMMARY_PROMPT } from "../lib/prompts.js";

const anthropic = new Anthropic();

export async function summarizeTranscript(
  transcript: string,
  videoTitle: string,
): Promise<{ content: string; keyPoints: string[] }> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: SUMMARY_PROMPT(videoTitle, transcript),
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // TODO: Parse structured response into content + keyPoints
  return {
    content: text,
    keyPoints: [],
  };
}
