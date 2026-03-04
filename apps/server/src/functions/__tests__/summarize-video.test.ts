import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer, severity } from "allure-js-commons";
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { NonRetriableError } from "inngest";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "insert", "update", "delete", "eq", "single"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let fromCallCount = 0;
let fromResults: ReturnType<typeof mockChain>[];

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "from")
          return () => {
            const result = fromResults[fromCallCount++] ?? mockChain({});
            return result;
          };
        return undefined;
      },
    },
  ),
}));

// ── Mock services ─────────────────────────────────────────────

const mockFetchTranscript = vi.fn();
const mockSummarizeTranscript = vi.fn();

vi.mock("../../services/transcript.js", () => ({
  fetchTranscript: (...args: unknown[]) => mockFetchTranscript(...args),
  TranscriptNotAvailableError: class TranscriptNotAvailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TranscriptNotAvailableError";
    }
  },
}));

vi.mock("../../services/summarizer.js", () => ({
  summarizeTranscript: (...args: unknown[]) => mockSummarizeTranscript(...args),
}));

// ── Mock Inngest (capture config for onFailure testing) ───────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

let capturedConfig: { onFailure: AnyFn } | null = null;

vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    createFunction: vi.fn((config, _trigger, handler) => {
      capturedConfig = config;
      return handler;
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────

/** step.run mock that just executes the callback */
function makeStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  };
}

const defaultEvent = {
  data: {
    summaryId: "sum-123",
    videoId: "dQw4w9WgXcQ",
    videoTitle: "Test Video",
  },
};

const sampleSummary: {
  summary: string;
  keyPoints: string[];
  timestamps: string[];
  contextSection?: { title: string; icon: string; items: string[] };
  truncated?: boolean;
} = {
  summary: "A summary",
  keyPoints: ["Point 1"],
  timestamps: ["0:00 - Intro"],
  contextSection: { title: "Steps", icon: "🔧", items: ["Do this"] },
};

function makeAPIError(status: number, message: string): APIError {
  return new APIError(status, { type: "error" }, message, undefined);
}

// ── Tests ─────────────────────────────────────────────────────

describe("summarize-video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
    layer("unit");
    epic("Inngest Functions");
    feature("Summarize Video");
  });

  describe("happy path", () => {
    it("fetches transcript, generates summary, and saves result", async () => {
      mockFetchTranscript.mockResolvedValue({ text: "transcript text", truncated: false });
      mockSummarizeTranscript.mockResolvedValue(sampleSummary);
      fromResults = [mockChain(), mockChain()]; // processing update + save result

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();
      const result = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step });

      expect(result).toEqual({ summaryId: "sum-123", status: "completed" });
      expect(mockFetchTranscript).toHaveBeenCalledWith("dQw4w9WgXcQ");
      expect(mockSummarizeTranscript).toHaveBeenCalledWith("transcript text", "Test Video");
      expect(step.run).toHaveBeenCalledTimes(3);
    });

    it("sets truncated flag on summaryJson when transcript was truncated", async () => {
      mockFetchTranscript.mockResolvedValue({ text: "truncated text", truncated: true });
      const summary = { ...sampleSummary };
      mockSummarizeTranscript.mockResolvedValue(summary);
      fromResults = [mockChain(), mockChain()]; // processing update + save result

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();
      await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step });

      expect(summary.truncated).toBe(true);
    });
  });

  describe("transcript errors", () => {
    it("throws NonRetriableError when transcript is not available", async () => {
      const { TranscriptNotAvailableError } = await import("../../services/transcript.js");
      mockFetchTranscript.mockRejectedValue(
        new TranscriptNotAvailableError("No captions available for this video"),
      );
      fromResults = [mockChain(), mockChain()]; // processing update + failed update

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      await expect(
        (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }),
      ).rejects.toThrow(NonRetriableError);
    });

    it("rethrows unknown transcript errors for Inngest retry", async () => {
      mockFetchTranscript.mockRejectedValue(new Error("Network timeout"));
      fromResults = [mockChain()];

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      await expect(
        (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }),
      ).rejects.toThrow("Network timeout");
    });
  });

  describe("Claude API error classification", () => {
    beforeEach(() => {
      mockFetchTranscript.mockResolvedValue({ text: "transcript text", truncated: false });
      fromResults = [mockChain()]; // processing update
    });

    it("rethrows APIConnectionError for Inngest retry", async () => {
      mockSummarizeTranscript.mockRejectedValue(
        new APIConnectionError({ message: "Connection reset" }),
      );

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      await expect(
        (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }),
      ).rejects.toThrow(APIConnectionError);
    });

    it("rethrows 429 rate limit error for Inngest retry", async () => {
      severity("critical");
      mockSummarizeTranscript.mockRejectedValue(makeAPIError(429, "Rate limited"));

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(APIError);
      expect((err as InstanceType<typeof APIError>).status).toBe(429);
    });

    it("rethrows 500 server error for Inngest retry", async () => {
      mockSummarizeTranscript.mockRejectedValue(makeAPIError(500, "Internal error"));

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(APIError);
      expect((err as InstanceType<typeof APIError>).status).toBe(500);
    });

    it("rethrows 503 overloaded error for Inngest retry", async () => {
      mockSummarizeTranscript.mockRejectedValue(makeAPIError(503, "Overloaded"));

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(APIError);
      expect((err as InstanceType<typeof APIError>).status).toBe(503);
    });

    it("does NOT retry 400 bad request (let Inngest default handle)", async () => {
      mockSummarizeTranscript.mockRejectedValue(makeAPIError(400, "Bad request"));

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      // 400 is not in our retryable list, so it falls through to the default rethrow
      expect(err).toBeInstanceOf(APIError);
      expect((err as InstanceType<typeof APIError>).status).toBe(400);
    });

    it("wraps JSON parse failures as NonRetriableError", async () => {
      severity("critical");
      mockSummarizeTranscript.mockRejectedValue(
        new Error("Failed to parse summary response as JSON"),
      );

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NonRetriableError);
      expect((err as Error).message).toBe("Failed to generate summary. Please try again.");
    });

    it("wraps 'missing required fields' parse error as NonRetriableError", async () => {
      mockSummarizeTranscript.mockRejectedValue(
        new Error("Failed to parse summary: missing required fields"),
      );

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      const err = await (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NonRetriableError);
    });

    it("rethrows unknown errors for Inngest retry", async () => {
      mockSummarizeTranscript.mockRejectedValue(new TypeError("Cannot read properties"));

      const { summarizeVideo } = await import("../summarize-video.js");
      const step = makeStep();

      await expect(
        (summarizeVideo as unknown as AnyFn)({ event: defaultEvent, step }),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("onFailure handler", () => {
    it("updates summary status to failed with error message", async () => {
      const updateChain = mockChain();
      fromResults = [updateChain];

      // Import to trigger createFunction and capture config
      await import("../summarize-video.js");
      expect(capturedConfig).not.toBeNull();

      await capturedConfig!.onFailure({
        event: {
          data: {
            event: { data: { summaryId: "sum-456" } },
            error: { message: "Something went wrong" },
          },
        },
      });

      expect(updateChain.update).toHaveBeenCalled();
      expect(updateChain.eq).toHaveBeenCalled();
    });
  });
});
