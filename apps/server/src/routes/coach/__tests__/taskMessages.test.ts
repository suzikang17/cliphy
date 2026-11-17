import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

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

const messageRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  person_id: "p1",
  bundle_id: "b1",
  channel: "imessage",
  direction: "in",
  text: "can the sconces go above the text on page 2",
  attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
  sent_at: "2026-11-10T09:59:00Z",
  ...over,
});

/** A database with one task (unless `task` is false), its links and the user's messages. */
function taskDb(opts: { task?: boolean; links?: string[]; messages?: unknown[] } = {}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_tasks") return { data: opts.task === false ? null : { id: "t1" } };
    if (op.table === "coach_task_messages" && op.action === "select") {
      return { data: (opts.links ?? []).map((message_id) => ({ message_id })) };
    }
    if (op.table === "coach_messages") return { data: opts.messages ?? [messageRow()] };
    if (op.table === "coach_people") return { data: { id: "p1" } };
    return undefined;
  });
}
const links = () =>
  db.ops.filter((o) => o.table === "coach_task_messages" && o.action !== "select");

describe("messages pulled into a task", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Tasks");
    db = makeDb();
  });

  it("lists a client's recent messages to pick from, both ways, newest first", async () => {
    db = taskDb({ messages: [messageRow({ id: "m2", direction: "out" }), messageRow()] });
    const res = await call("GET", "/people/p1/messages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["m2", "m1"]);
    expect(body.messages[1].attachments[0].url).toBe("https://signed/coach/test-user-id/a.png");
    const read = db.ops.find((o) => o.table === "coach_messages")!;
    expect(eqValue(read, "person_id")).toBe("p1");
    expect(eqValue(read, "user_id")).toBe("test-user-id");
  });

  it("pulls messages into a task", async () => {
    db = taskDb({ messages: [messageRow(), messageRow({ id: "m2" })] });
    const res = await call("POST", "/tasks/t1/messages", { messageIds: ["m1", "m2"] });
    expect(res.status).toBe(200);
    expect(links()[0].action).toBe("upsert");
    expect(links()[0].payload).toEqual([
      { task_id: "t1", message_id: "m1", user_id: "test-user-id" },
      { task_id: "t1", message_id: "m2", user_id: "test-user-id" },
    ]);
    expect(links()[0].options).toMatchObject({ ignoreDuplicates: true });
  });

  it("refuses a message that is not this user's", async () => {
    db = taskDb({ messages: [messageRow()] });
    const res = await call("POST", "/tasks/t1/messages", { messageIds: ["m1", "someone-elses"] });
    expect(res.status).toBe(404);
    expect(links()).toEqual([]);
  });

  it("refuses an empty or malformed list", async () => {
    db = taskDb();
    expect((await call("POST", "/tasks/t1/messages", { messageIds: [] })).status).toBe(400);
    expect((await call("POST", "/tasks/t1/messages", { messageIds: "m1" })).status).toBe(400);
    expect(links()).toEqual([]);
  });

  it("shows the messages on the task, oldest first", async () => {
    db = taskDb({ links: ["m1"] });
    const res = await call("GET", "/tasks/t1/messages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0]).toMatchObject({ id: "m1", direction: "in" });
    expect(body.messages[0].attachments[0].url).toBe("https://signed/coach/test-user-id/a.png");
  });

  it("shows none without asking for messages when nothing was pulled in", async () => {
    db = taskDb({ links: [] });
    expect((await (await call("GET", "/tasks/t1/messages")).json()).messages).toEqual([]);
    expect(db.ops.some((o) => o.table === "coach_messages")).toBe(false);
  });

  it("takes a message off a task", async () => {
    db = taskDb({ links: ["m1"] });
    const res = await call("DELETE", "/tasks/t1/messages/m1");
    expect(res.status).toBe(200);
    expect(links()[0].action).toBe("delete");
    expect(eqValue(links()[0], "message_id")).toBe("m1");
    expect(eqValue(links()[0], "task_id")).toBe("t1");
  });

  it("404s for a task that is not this user's", async () => {
    db = taskDb({ task: false });
    expect((await call("GET", "/tasks/nope/messages")).status).toBe(404);
    expect((await call("POST", "/tasks/nope/messages", { messageIds: ["m1"] })).status).toBe(404);
    expect((await call("DELETE", "/tasks/nope/messages/m1")).status).toBe(404);
    expect(links()).toEqual([]);
  });

  it("404s for a client that is not this user's", async () => {
    db = makeDb();
    expect((await call("GET", "/people/nope/messages")).status).toBe(404);
  });
});
