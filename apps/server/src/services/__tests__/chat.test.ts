import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage, SummaryJson } from "@cliphy/shared";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  },
}));

import { chatWithVideo } from "../chat.js";

const transcript = "Hello, today we'll talk about attention mechanisms...";
const summaryJson: SummaryJson = {
  summary: "This video explains attention.",
  keyPoints: ["Attention is key"],
  timestamps: ["0:00 - Intro"],
};

describe("chatWithVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a chat response for a question", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            type: "chat",
            content: "They discuss attention at 2:30.",
          }),
        },
      ],
    });
    const result = await chatWithVideo({
      transcript,
      videoTitle: "Attention Explained",
      summaryJson,
      messages: [{ role: "user", content: "What about attention?" }],
    });
    expect(result.type).toBe("chat");
    expect(result.content).toBe("They discuss attention at 2:30.");
    expect(result.updatedSummaryJson).toBeUndefined();
  });

  it("returns an update response with modified summary", async () => {
    const updated: SummaryJson = {
      ...summaryJson,
      summary: "A technical deep dive into attention.",
    };
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            type: "update",
            content: "Made TL;DR more technical.",
            updatedSection: "summary",
            updatedSummaryJson: updated,
          }),
        },
      ],
    });
    const result = await chatWithVideo({
      transcript,
      videoTitle: "Attention Explained",
      summaryJson,
      messages: [{ role: "user", content: "Make TL;DR more technical" }],
    });
    expect(result.type).toBe("update");
    expect(result.updatedSection).toBe("summary");
    expect(result.updatedSummaryJson?.summary).toBe("A technical deep dive into attention.");
  });

  it("falls back to chat type on JSON parse failure", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Not valid JSON at all" }],
    });
    const result = await chatWithVideo({
      transcript,
      videoTitle: "Test",
      summaryJson,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.type).toBe("chat");
    expect(result.content).toBe("Not valid JSON at all");
  });

  it("passes conversation history to Claude", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({ type: "chat", content: "Yes." }),
        },
      ],
    });
    const messages: ChatMessage[] = [
      { role: "user", content: "What is attention?" },
      { role: "assistant", content: "A mechanism for..." },
      { role: "user", content: "Can you elaborate?" },
    ];
    await chatWithVideo({ transcript, videoTitle: "Test", summaryJson, messages });
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages.length).toBe(4); // user prompt + 3 history messages
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toContain("Transcript:");
  });
});
