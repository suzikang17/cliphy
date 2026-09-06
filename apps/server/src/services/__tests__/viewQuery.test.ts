import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function mockChain(result: Record<string, unknown> = {}) {
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
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
    "contains",
    "overlaps",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
const semanticSearch = vi.fn(async () => []);
vi.mock("../search.js", () => ({
  semanticSearch: (...a: unknown[]) => semanticSearch(...(a as [])),
}));
vi.mock("../../lib/storage.js", () => ({
  resolveClipImage: vi.fn(async (c: unknown) => c),
}));

const { sanitizeViewQuery, runViewQuery } = await import("../viewQuery.js");

describe("viewQuery", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Views");
    vi.clearAllMocks();
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: [], error: null })) };
  });

  it("drops unknown keys", () => {
    const clean = sanitizeViewQuery({ semantic: "x", dropTable: "clips", nope: 1 });
    expect(clean).toEqual({ semantic: "x", limit: 12 });
  });

  it("keeps only known fields with correct types", () => {
    const clean = sanitizeViewQuery({
      tags: ["design", 42],
      sourceType: ["web", "bogus"],
      category: "reading",
      author: "@someone",
      limit: 5,
    });
    expect(clean.tags).toEqual(["design"]);
    expect(clean.sourceType).toEqual(["web"]);
    expect(clean.category).toBe("reading");
    expect(clean.author).toBe("@someone");
    expect(clean.limit).toBe(5);
  });

  it("clamps an absurd limit", () => {
    expect(sanitizeViewQuery({ limit: 9999 }).limit).toBe(50);
    expect(sanitizeViewQuery({ limit: -3 }).limit).toBe(12);
  });

  it("routes a semantic query to semanticSearch", async () => {
    await runViewQuery("u1", { semantic: "design inspiration", limit: 7 });
    expect(semanticSearch).toHaveBeenCalledWith("u1", "design inspiration", 7);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("builds a filter query when there is no semantic term", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await runViewQuery("u1", { tags: ["design"], sourceType: ["web"], limit: 4 });

    expect(supabaseMock.from).toHaveBeenCalledWith("clips");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(chain.overlaps).toHaveBeenCalledWith("tags", ["design"]);
    expect(chain.in).toHaveBeenCalledWith("source_type", ["web"]);
    expect(chain.limit).toHaveBeenCalledWith(4);
  });

  it("excludes deleted and archived clips from a view", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await runViewQuery("u1", { tags: ["design"] });

    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(chain.is).toHaveBeenCalledWith("archived_at", null);
  });
});
