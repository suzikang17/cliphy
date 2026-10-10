import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function chain(result: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update", "upsert"]) c[m] = vi.fn().mockReturnValue(c);
  (c as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return c;
}
let next: ReturnType<typeof chain>[] = [];
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: () => next.shift() ?? chain() } }));

const {
  loadPageTags,
  reusableAssignment,
  saveAiAssignments,
  setOverrides,
  tagsForPages,
  TAG_TTL_MS,
  NONE_TTL_MS,
} = await import("../page-tags.js");

const NOW = Date.parse("2026-10-10T12:00:00Z");
const row = (over: Record<string, unknown>) => ({
  url: "https://a.com/x",
  ai_kind: "tag",
  ai_value: "design",
  ai_source: "jev",
  ai_at: new Date(NOW - 1000).toISOString(),
  done: false,
  override: null,
  ...over,
});

describe("page-tags", () => {
  beforeEach(() => {
    layer("unit");
    epic("Tabs view");
    feature("Persisted page tags");
    next = [];
  });

  it("looks pages up by normalized URL", async () => {
    const q = chain({ data: [row({})] });
    next = [q];
    const m = await loadPageTags("u1", ["https://www.a.com/x?utm_source=t#h", "https://b.com/"]);
    expect(q.in).toHaveBeenCalledWith("url", ["https://a.com/x", "https://b.com/"]);
    expect(m.get("https://a.com/x")?.ai_value).toBe("design");
  });

  it("reuses tags for 30 days, 'none' for a day, and never without a timestamp", () => {
    expect(reusableAssignment(row({}), NOW)).toEqual({ tag: "design" });
    expect(
      reusableAssignment(row({ ai_at: new Date(NOW - TAG_TTL_MS - 1).toISOString() }), NOW),
    ).toBeNull();
    expect(reusableAssignment(row({ ai_kind: "proposed", ai_value: "client:x" }), NOW)).toEqual({
      proposed: "client:x",
    });
    expect(reusableAssignment(row({ ai_kind: "none", ai_value: null }), NOW)).toEqual({
      none: true,
    });
    expect(
      reusableAssignment(
        row({
          ai_kind: "none",
          ai_value: null,
          ai_at: new Date(NOW - NONE_TTL_MS - 1).toISOString(),
        }),
        NOW,
      ),
    ).toBeNull();
    expect(reusableAssignment(row({ ai_at: null }), NOW)).toBeNull();
  });

  it("saves AI answers one row per page, without touching overrides", async () => {
    const up = chain({ error: null });
    next = [up];
    await saveAiAssignments("u1", [
      { url: "https://a.com/x", assignment: { tag: "design" }, source: "jev", done: false },
      { url: "https://www.a.com/x#dup", assignment: { tag: "design" }, source: "jev", done: true },
      { url: "https://b.com", assignment: { none: true }, source: "claude", done: false },
    ]);
    const rows = (up.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: "https://a.com/x",
      ai_kind: "tag",
      ai_value: "design",
      ai_source: "jev",
      done: true,
    });
    expect(rows[1]).toMatchObject({
      url: "https://b.com/",
      ai_kind: "none",
      ai_value: null,
      ai_source: "claude",
    });
    expect(rows[0]).not.toHaveProperty("override");
  });

  it("stores manual choices (null clears) and tagsForPages prefers them", async () => {
    const up = chain({ error: null });
    next = [up];
    await setOverrides("u1", [
      { url: "https://a.com/x", override: "tag:freelance" },
      { url: "https://b.com", override: null },
    ]);
    expect((up.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([
      expect.objectContaining({ url: "https://a.com/x", override: "tag:freelance" }),
      expect.objectContaining({ url: "https://b.com/", override: null }),
    ]);

    next = [
      chain({
        data: [
          row({ override: "tag:freelance" }),
          row({ url: "https://b.com/", override: "site:b.com" }), // manual non-tag choice → no tag
          row({ url: "https://c.com/", override: null, ai_kind: "proposed", ai_value: "x" }), // proposal ≠ tag
          row({ url: "https://d.com/" }),
        ],
      }),
    ];
    const tags = await tagsForPages("u1", [
      "https://a.com/x",
      "https://b.com",
      "https://c.com",
      "https://d.com",
    ]);
    expect([...tags.entries()]).toEqual([
      ["https://a.com/x", "freelance"],
      ["https://d.com", "design"],
    ]);
  });
});
