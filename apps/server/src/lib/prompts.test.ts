import { describe, it, expect } from "vitest";
import { SUMMARY_USER_PROMPT, chatUserPrompt } from "./prompts.js";

describe("SUMMARY_USER_PROMPT", () => {
  it("includes language instructions when provided", () => {
    const result = SUMMARY_USER_PROMPT("Test Video", "hello world", "Korean", "English");
    expect(result).toContain("Respond in Korean");
    expect(result).toContain("Transcript (language: English):");
    expect(result).toContain("hello world");
    expect(result).toContain("Test Video");
  });

  it("omits language instructions when not provided", () => {
    const result = SUMMARY_USER_PROMPT("Test Video", "hello world");
    expect(result).not.toContain("Respond in");
    expect(result).toContain("Transcript:");
    expect(result).not.toContain("Transcript (language:");
  });
});

describe("chatUserPrompt", () => {
  it("includes language instruction when provided", () => {
    const result = chatUserPrompt("Test Video", "transcript", "summary", "Korean");
    expect(result).toContain("Respond in Korean");
  });

  it("omits language instruction when not provided", () => {
    const result = chatUserPrompt("Test Video", "transcript", "summary");
    expect(result).not.toContain("Respond in");
  });
});
