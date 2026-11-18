import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

// A person's whole thread, a page at a time, with what has become of each
// message: checked off by hand, turned into a request, or put in a batch.

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const call = (method: string, path: string, body?: unknown) =>
  app().request(`/api/coach${path}`, json(method, body));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  person_id: "p1",
  bundle_id: null,
  channel: "imessage",
  direction: "in",
  text: `text ${id}`,
  attachments: [],
  sent_at: "2026-11-10T10:00:00Z",
  handled_at: null,
  ...over,
});

function threadDb(opts: {
  person?: boolean;
  messages?: Record<string, unknown>[];
  requests?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_people") return { data: opts.person === false ? null : { id: "p1" } };
    if (op.table === "coach_messages" && op.action === "select")
      return { data: opts.messages ?? [] };
    if (op.table === "coach_messages" && op.action === "update") {
      return { data: (opts.messages ?? []).map((m) => ({ id: m.id })) };
    }
    if (op.table === "coach_requests") return { data: opts.requests ?? [] };
    if (op.table === "coach_batch_items") return { data: opts.items ?? [] };
    if (op.table === "coach_task_messages") return { data: opts.links ?? [] };
    return undefined;
  });
}

const reads = () => db.ops.filter((o) => o.table === "coach_messages" && o.action === "select");

beforeEach(async () => {
  await layer("unit");
  await epic("Coach");
  await feature("Thread");
});

describe("GET /people/:id/messages, a page at a time", () => {
  it("says what has become of each message", async () => {
    db = threadDb({
      messages: [
        row("m3", { handled_at: "2026-11-12T09:00:00Z" }),
        row("m2", { bundle_id: "b1" }),
        row("m1"),
      ],
      requests: [{ id: "r1", bundle_id: "b1" }],
      items: [{ message_id: "m1", batch_id: "batch1", state: "done" }],
    });
    const res = await call("GET", "/people/p1/messages?limit=50");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Record<string, unknown>[]; hasMore: boolean };
    expect(body.messages.map((m) => [m.id, m.handledAt, m.requestId, m.batchId])).toEqual([
      ["m3", "2026-11-12T09:00:00Z", null, null],
      ["m2", null, "r1", null],
      ["m1", null, null, "batch1"],
    ]);
    expect(body.hasMore).toBe(false);
  });

  it("says which task a message was pulled into", async () => {
    db = threadDb({
      messages: [row("m1"), row("m2")],
      links: [{ message_id: "m1", task_id: "t1" }],
    });
    const body = (await (await call("GET", "/people/p1/messages?limit=50")).json()) as {
      messages: { id: string; taskId: string | null }[];
    };
    expect(body.messages.map((m) => [m.id, m.taskId])).toEqual([
      ["m1", "t1"],
      ["m2", null],
    ]);
  });

  it("does not count a batch the message was carried out of", async () => {
    db = threadDb({
      messages: [row("m1")],
      items: [{ message_id: "m1", batch_id: "batch1", state: "not_done" }],
    });
    const body = (await (await call("GET", "/people/p1/messages?limit=50")).json()) as {
      messages: { batchId: string | null }[];
    };
    expect(body.messages[0].batchId).toBeNull();
  });

  it("reads one more than asked for, to know whether older messages remain", async () => {
    db = threadDb({ messages: [row("m3"), row("m2"), row("m1")] });
    const res = await call("GET", "/people/p1/messages?limit=2");
    const body = (await res.json()) as { messages: { id: string }[]; hasMore: boolean };
    expect(body.messages.map((m) => m.id)).toEqual(["m3", "m2"]);
    expect(body.hasMore).toBe(true);
  });

  it("continues from before a given time", async () => {
    db = threadDb({ messages: [row("m1")] });
    await call("GET", "/people/p1/messages?limit=50&before=2026-11-10T10%3A00%3A00Z");
    expect(reads()[0].filters).toContainEqual(["lt", "sent_at", "2026-11-10T10:00:00Z"]);
  });

  it("refuses a time that is not a time, and caps the page size", async () => {
    db = threadDb({ messages: [] });
    expect((await call("GET", "/people/p1/messages?before=yesterday")).status).toBe(400);
    expect((await call("GET", "/people/p1/messages?limit=5000")).status).toBe(400);
  });
});

describe("POST /people/:id/messages/handled", () => {
  it("checks messages off", async () => {
    db = threadDb({ messages: [row("m1"), row("m2")] });
    const res = await call("POST", "/people/p1/messages/handled", {
      messageIds: ["m1", "m2"],
      handled: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    const write = db.ops.find((o) => o.table === "coach_messages" && o.action === "update")!;
    expect((write.payload as { handled_at: string }).handled_at).toMatch(/^\d{4}-/);
    expect(eqValue(write, "user_id")).toBe("test-user-id");
    expect(eqValue(write, "person_id")).toBe("p1");
    expect(write.filters).toContainEqual(["in", "id", ["m1", "m2"]]);
  });

  it("unchecks them", async () => {
    db = threadDb({ messages: [row("m1")] });
    await call("POST", "/people/p1/messages/handled", { messageIds: ["m1"], handled: false });
    const write = db.ops.find((o) => o.table === "coach_messages" && o.action === "update")!;
    expect(write.payload).toEqual({ handled_at: null });
  });

  it("refuses an empty or malformed list, and someone else's person", async () => {
    db = threadDb({});
    expect((await call("POST", "/people/p1/messages/handled", { messageIds: [] })).status).toBe(
      400,
    );
    expect(
      (await call("POST", "/people/p1/messages/handled", { messageIds: "m1", handled: true }))
        .status,
    ).toBe(400);
    db = threadDb({ person: false });
    expect(
      (await call("POST", "/people/p1/messages/handled", { messageIds: ["m1"], handled: true }))
        .status,
    ).toBe(404);
    expect(db.written("coach_messages")).toEqual([]);
  });
});
