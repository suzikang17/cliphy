import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer, severity, story } from "allure-js-commons";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../../env.js";

// ── Mocks ────────────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "lt",
    "gte",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
    "rpc",
    "contains",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

// Sequential-call mock: each call to supabase.from() pops from fromResults
let fromCallCount = 0;
let fromResults: ReturnType<typeof mockChain>[] = [];

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "auth") {
          return {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: "test-user-id", email: "test@example.com" } },
              error: null,
            }),
          };
        }
        if (prop === "from") {
          return () => {
            const result = fromResults[fromCallCount] ?? mockChain({});
            fromCallCount++;
            return result;
          };
        }
        return undefined;
      },
    },
  ),
}));

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      c.set("userEmail", "test@example.com");
      await next();
    },
  ),
}));

vi.mock("../../middleware/require-pro.js", () => ({
  requirePro: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

const mockSuggestTags = vi.fn();
const mockSuggestTagsBulk = vi.fn();

vi.mock("../../services/auto-tag.js", () => ({
  suggestTags: (...args: unknown[]) => mockSuggestTags(...args),
  suggestTagsBulk: (...args: unknown[]) => mockSuggestTagsBulk(...args),
}));

// ── App factory ───────────────────────────────────────────────

async function createApp() {
  const { summaryRoutes } = await import("../../routes/summaries.js");
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: ["chrome-extension://test"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.route("/summaries", summaryRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────

describe("Auto-tag integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
    layer("integration");
    epic("Summaries");
    feature("Auto-tag");
  });

  // ── POST /summaries/:id/auto-tag ──────────────────────────

  describe("POST /summaries/:id/auto-tag", () => {
    beforeEach(() => story("Single summary auto-tag"));

    it("returns tag suggestions for a completed summary", async () => {
      const fakeSummaryJson = {
        summary: "A tutorial about TypeScript generics",
        keyPoints: ["generics", "type safety"],
        contextSection: { title: "TypeScript Deep Dive" },
      };

      // 1st from() → fetch summary by id (single)
      fromResults.push(mockChain({ data: { id: "sum-1", summary_json: fakeSummaryJson } }));
      // 2nd from() → fetch existing tags
      fromResults.push(mockChain({ data: [{ tags: ["typescript"] }] }));

      mockSuggestTags.mockResolvedValue({ existing: ["typescript"], new: ["generics"] });

      const app = await createApp();
      const res = await app.request("/summaries/sum-1/auto-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.existing).toEqual(["typescript"]);
      expect(json.new).toEqual(["generics"]);
    });

    it("returns 404 when summary is not found", async () => {
      severity("critical");

      // from() → fetch summary returns null (not found)
      fromResults.push(mockChain({ data: null }));

      const app = await createApp();
      const res = await app.request("/summaries/nonexistent-id/auto-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/not found/i);
    });

    it("returns 400 when summary has no content (pending/failed)", async () => {
      // Summary exists but has no summary_json
      fromResults.push(mockChain({ data: { id: "sum-pending", summary_json: null } }));

      const app = await createApp();
      const res = await app.request("/summaries/sum-pending/auto-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/not ready/i);
    });
  });

  // ── POST /summaries/auto-tag/bulk ─────────────────────────

  describe("POST /summaries/auto-tag/bulk", () => {
    beforeEach(() => story("Bulk auto-tag"));

    it("returns 400 when summaryIds is an empty array", async () => {
      const app = await createApp();
      const res = await app.request("/summaries/auto-tag/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryIds: [] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/non-empty/i);
    });

    it("returns 400 when summaryIds has more than 20 items", async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `sum-${i}`);

      const app = await createApp();
      const res = await app.request("/summaries/auto-tag/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryIds: ids }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/max 20/i);
    });

    it("returns suggestions for multiple summaries (happy path)", async () => {
      const fakeSummaryJson1 = {
        summary: "Intro to React hooks",
        keyPoints: ["useState", "useEffect"],
        contextSection: null,
      };
      const fakeSummaryJson2 = {
        summary: "Advanced TypeScript patterns",
        keyPoints: ["generics", "conditional types"],
        contextSection: null,
      };

      // 1st from() → fetch summaries by ids
      fromResults.push(
        mockChain({
          data: [
            { id: "sum-1", summary_json: fakeSummaryJson1 },
            { id: "sum-2", summary_json: fakeSummaryJson2 },
          ],
        }),
      );
      // 2nd from() → fetch existing tags
      fromResults.push(mockChain({ data: [{ tags: ["react"] }] }));

      mockSuggestTagsBulk.mockResolvedValue([
        { id: "sum-1", existing: ["react"], new: ["hooks"] },
        { id: "sum-2", existing: [], new: ["typescript"] },
      ]);

      const app = await createApp();
      const res = await app.request("/summaries/auto-tag/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryIds: ["sum-1", "sum-2"] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.suggestions).toHaveLength(2);

      const s1 = json.suggestions.find((s: { summaryId: string }) => s.summaryId === "sum-1");
      expect(s1?.existing).toEqual(["react"]);
      expect(s1?.new).toEqual(["hooks"]);

      const s2 = json.suggestions.find((s: { summaryId: string }) => s.summaryId === "sum-2");
      expect(s2?.existing).toEqual([]);
      expect(s2?.new).toEqual(["typescript"]);
    });

    it("marks summaries without content as skipped", async () => {
      // 1st from() → fetch summaries by ids (sum-no-content has null summary_json)
      fromResults.push(
        mockChain({
          data: [
            {
              id: "sum-1",
              summary_json: {
                summary: "React hooks",
                keyPoints: [],
                contextSection: null,
              },
            },
            { id: "sum-no-content", summary_json: null },
          ],
        }),
      );
      // 2nd from() → fetch existing tags
      fromResults.push(mockChain({ data: [] }));

      mockSuggestTagsBulk.mockResolvedValue([{ id: "sum-1", existing: [], new: ["react"] }]);

      const app = await createApp();
      const res = await app.request("/summaries/auto-tag/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryIds: ["sum-1", "sum-no-content"] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.suggestions).toHaveLength(2);

      const skipped = json.suggestions.find(
        (s: { summaryId: string; skipped?: boolean }) => s.summaryId === "sum-no-content",
      );
      expect(skipped?.skipped).toBe(true);

      const tagged = json.suggestions.find(
        (s: { summaryId: string; skipped?: boolean }) => s.summaryId === "sum-1",
      );
      expect(tagged?.skipped).toBeUndefined();
      expect(tagged?.new).toEqual(["react"]);
    });
  });
});
