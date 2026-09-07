import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

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
const inngestSend = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../lib/storage.js", () => ({ resolveClipImage: vi.fn(async (c: unknown) => c) }));

const { notesRoutes } = await import("../notes.js");

function app() {
  return new Hono().route("/api/notes", notesRoutes);
}

function append(body: unknown) {
  return app().request("/api/notes/append", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const noteRow = (content: string) => ({
  id: "n1",
  user_id: "test-user-id",
  source_type: "note",
  content,
  video_title: "Daily note",
  source_metadata: { noteDate: "2026-09-07" },
  status: "completed",
  tags: [],
  created_at: "t",
  updated_at: "t",
});

describe("notes routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Notes");
    feature("Daily note");
    vi.clearAllMocks();
  });

  it("creates today's note when none exists yet", async () => {
    const lookup = mockChain({ data: null, error: null });
    const insert = mockChain({ data: noteRow("first thought"), error: null });
    supabaseMock = { from: vi.fn().mockReturnValueOnce(lookup).mockReturnValue(insert) };

    const res = await append({ text: "first thought", date: "2026-09-07" });

    expect(res.status).toBe(200);
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "note",
        content: "first thought",
        source_metadata: { noteDate: "2026-09-07" },
      }),
    );
  });

  it("appends to today's note when it already exists", async () => {
    const lookup = mockChain({ data: noteRow("first thought"), error: null });
    const update = mockChain({ data: noteRow("first thought\nsecond thought"), error: null });
    supabaseMock = { from: vi.fn().mockReturnValueOnce(lookup).mockReturnValue(update) };

    const res = await append({ text: "second thought", date: "2026-09-07" });

    expect(res.status).toBe(200);
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: "first thought\nsecond thought" }),
    );
    expect(update.insert).not.toHaveBeenCalled();
  });

  it("looks the note up by the client's local date, not the server's", async () => {
    const lookup = mockChain({ data: null, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(lookup) };

    await append({ text: "x", date: "2026-01-15" });

    expect(lookup.eq).toHaveBeenCalledWith("source_metadata->>noteDate", "2026-01-15");
  });

  it("re-embeds after every write so search stays current", async () => {
    const lookup = mockChain({ data: noteRow("a"), error: null });
    const update = mockChain({ data: noteRow("a\nb"), error: null });
    supabaseMock = { from: vi.fn().mockReturnValueOnce(lookup).mockReturnValue(update) };

    await append({ text: "b", date: "2026-09-07" });

    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clip/embed.requested" }),
    );
  });

  it("rejects an empty note", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null })) };
    const res = await append({ text: "   ", date: "2026-09-07" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null })) };
    const res = await append({ text: "hi", date: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("replaces the whole body on edit", async () => {
    const update = mockChain({ data: noteRow("rewritten"), error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(update) };

    const res = await app().request("/api/notes/n1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "rewritten" }),
    });

    expect(res.status).toBe(200);
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ content: "rewritten" }));
    expect(update.eq).toHaveBeenCalledWith("user_id", "test-user-id");
  });
});
