import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatResponse, SummaryJson } from "@cliphy/shared";
import { CHAT_SYSTEM_PROMPT, chatUserPrompt } from "../lib/prompts.js";

const anthropic = new Anthropic();

interface ChatWithVideoParams {
  transcript: string;
  videoTitle: string;
  summaryJson: SummaryJson;
  messages: ChatMessage[];
}

export async function chatWithVideo({
  transcript,
  videoTitle,
  summaryJson,
  messages,
}: ChatWithVideoParams): Promise<ChatResponse> {
  const userContext = chatUserPrompt(videoTitle, transcript, JSON.stringify(summaryJson, null, 2));

  const claudeMessages: Anthropic.MessageParam[] = [
    { role: "user", content: userContext },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0.3,
    system: CHAT_SYSTEM_PROMPT,
    messages: claudeMessages,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text) as ChatResponse;
    if (parsed.type === "update" && parsed.updatedSummaryJson) {
      const sj = parsed.updatedSummaryJson;
      if (!sj.summary || !Array.isArray(sj.keyPoints) || !Array.isArray(sj.timestamps)) {
        return { type: "chat", content: parsed.content || text };
      }
    }
    return {
      type: parsed.type === "update" ? "update" : "chat",
      content: parsed.content || text,
      updatedSection: parsed.type === "update" ? parsed.updatedSection : undefined,
      updatedSummaryJson: parsed.type === "update" ? parsed.updatedSummaryJson : undefined,
    };
  } catch {
    return { type: "chat", content: text };
  }
}
