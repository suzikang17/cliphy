import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
const writeSummary = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);
vi.mock("../../../services/coach/batchSummary.js", async (original) => ({
  ...(await original<typeof import("../../../services/coach/batchSummary.js")>()),
  writeSummary: (...args: unknown[]) => writeSummary(...args),
}));

const { coachRoutes } = await import("../index.js");
const { noteOutgoing } = await import("../../../services/coach/batches.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const call = (method: string, path: string, body?: unknown) =>
  app().request(`/api/coach/batches${path}`, json(method, body));

const SUMMARY = "Changes are live on Alder House:\n- Sconces now sit above the text on page 2";

const person = { id: "p1", name: "Maren" };
const requestRow = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  bundle_id: "b1",
  person_id: "p1",
  project_id: "pr1",
  understood: "Move the sconces above the paragraph on page 2",
  status: "confirmed",
  created_at: "2026-11-10T10:00:00Z",
  ...over,
});
const messageRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  person_id: "p1",
  bundle_id: "b1",
  channel: "imessage",
  direction: "in",
  text: "can the sconces go above the text on page 2",
  attachments: [],
  sent_at: "2026-11-10T09:59:00Z",
  ...over,
});
const batchRow = (over: Record<string, unknown> = {}) => ({
  id: "ba1",
  user_id: "test-user-id",
  person_id: "p1",
  project_id: "pr1",
  status: "checking",
  summary: null,
  sent_at: null,
  created_at: "2026-11-17T10:00:00Z",
  ...over,
});
const itemRow = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  batch_id: "ba1",
  request_id: "r1",
  message_id: null,
  label: "Move the sconces above the paragraph on page 2",
  state: "unchecked",
  note: null,
  position: 0,
  ...over,
});

/** A database with one batch, its items and the rows they point at. */
function withBatch(
  batch: Record<string, unknown> | null,
  items: Record<string, unknown>[] = [itemRow()],
  more: (op: Op) => unknown = () => undefined,
) {
  return makeDb((op) => {
    const extra = more(op);
    if (extra !== undefined) return extra as { data?: unknown };
    if (op.table === "coach_batches") return { data: op.single ? batch : batch ? [batch] : [] };
    if (op.table === "coach_batch_items") {
      if (op.action !== "select") return { data: items[0] };
      return { data: op.single ? (items[0] ?? null) : items };
    }
    if (op.table === "coach_people") return { data: person };
    if (op.table === "coach_projects") return { data: { id: "pr1", name: "Alder House" } };
    if (op.table === "coach_requests") return { data: [requestRow()] };
    if (op.table === "coach_messages") return { data: [messageRow()] };
    if (op.table === "coach_tasks") {
      return {
        data: [{ request_id: "r1", title: "Move the sconces up on page 2", state: "done" }],
      };
    }
    return undefined;
  });
}
const writes = (table: string) => db.ops.filter((o) => o.table === table && o.action !== "select");

describe("batches: finished work, checked and summarized for the client", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Batches");
    db = makeDb();
    writeSummary.mockReset();
  });

  describe("what can go into a batch", () => {
    it("offers a client's requests that are not already in a batch", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_requests") {
          return {
            data: [
              requestRow(),
              requestRow({ id: "r2", bundle_id: "b2" }),
              requestRow({ id: "r3", bundle_id: "b3", status: "replaced" }),
            ],
          };
        }
        if (op.table === "coach_batch_items") {
          return {
            data: [
              { request_id: "r2", message_id: null, state: "done" },
              { request_id: "r1", message_id: null, state: "not_done" },
            ],
          };
        }
        if (op.table === "coach_messages") return { data: [] };
        return undefined;
      });
      const res = await call("GET", "/candidates?personId=p1");
      expect(res.status).toBe(200);
      const body = await res.json();
      // r2 is done in a batch and r3 was replaced; r1 was carried over, so it is free.
      expect(body.requests.map((r: { id: string }) => r.id)).toEqual(["r1"]);
    });

    it("offers messages from the client that never became a request", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_requests") return { data: [requestRow()] };
        if (op.table === "coach_batch_items") return { data: [] };
        if (op.table === "coach_messages") {
          return {
            data: [
              messageRow(),
              messageRow({ id: "m2", bundle_id: "b9", text: "also the footer link is broken" }),
            ],
          };
        }
        return undefined;
      });
      const body = await (await call("GET", "/candidates?personId=p1")).json();
      expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["m2"]);
      const read = db.ops.find((o) => o.table === "coach_messages")!;
      expect(eqValue(read, "direction")).toBe("in");
      expect(eqValue(read, "user_id")).toBe("test-user-id");
    });

    it("offers tasks added by hand on the project", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_batch_items") {
          return { data: [{ request_id: null, message_id: null, task_id: "t2", state: "done" }] };
        }
        if (op.table === "coach_tasks") {
          return {
            data: [
              { id: "t1", kind: "do", state: "done", title: "Fix the footer link" },
              { id: "t2", kind: "do", state: "done", title: "Already reported" },
            ],
          };
        }
        return { data: [] };
      });
      const body = await (await call("GET", "/candidates?personId=p1&projectId=pr1")).json();
      expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["t1"]);
      const read = db.ops.find((o) => o.table === "coach_tasks")!;
      expect(eqValue(read, "project_id")).toBe("pr1");
      // Only tasks with no request behind them: the rest are offered as requests.
      expect(read.filters).toContainEqual(["is", "request_id", null]);
    });

    it("needs a client", async () => {
      expect((await call("GET", "/candidates")).status).toBe(400);
    });
  });

  describe("making one", () => {
    it("stores the batch and one item per request and message", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_people") return { data: person };
        if (op.table === "coach_requests") return { data: [requestRow()] };
        if (op.table === "coach_messages") {
          return { data: [messageRow({ id: "m2", text: "also the footer link is broken" })] };
        }
        if (op.table === "coach_batches") return { data: batchRow() };
        if (op.table === "coach_projects") return { data: { id: "pr1" } };
        return undefined;
      });
      const res = await call("POST", "", {
        personId: "p1",
        projectId: "pr1",
        requestIds: ["r1"],
        messageIds: ["m2"],
      });
      expect(res.status).toBe(201);
      expect((await res.json()).batch).toMatchObject({ id: "ba1", status: "checking" });
      expect(db.written("coach_batches", "insert")[0]).toEqual({
        user_id: "test-user-id",
        person_id: "p1",
        project_id: "pr1",
      });
      expect(db.written("coach_batch_items", "insert")[0]).toEqual([
        {
          user_id: "test-user-id",
          batch_id: "ba1",
          request_id: "r1",
          message_id: null,
          label: "Move the sconces above the paragraph on page 2",
          position: 0,
        },
        {
          user_id: "test-user-id",
          batch_id: "ba1",
          request_id: null,
          message_id: "m2",
          label: "also the footer link is broken",
          position: 1,
        },
      ]);
    });

    it("takes a task added by hand, labelled with its title", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_people") return { data: person };
        if (op.table === "coach_tasks")
          return { data: [{ id: "t1", title: "Fix the footer link" }] };
        if (op.table === "coach_batches") return { data: batchRow({ project_id: null }) };
        return undefined;
      });
      const res = await call("POST", "", { personId: "p1", taskIds: ["t1"] });
      expect(res.status).toBe(201);
      expect(db.written("coach_batch_items", "insert")[0]).toEqual([
        {
          user_id: "test-user-id",
          batch_id: "ba1",
          request_id: null,
          message_id: null,
          task_id: "t1",
          label: "Fix the footer link",
          position: 0,
        },
      ]);
    });

    it("shows a hand-added task beside the messages pulled into it", async () => {
      db = withBatch(
        batchRow(),
        [itemRow({ request_id: null, task_id: "t1", label: "Fix the footer link" })],
        (op) => {
          if (op.table === "coach_task_messages") {
            return { data: [{ task_id: "t1", message_id: "m7" }] };
          }
          if (op.table === "coach_messages") {
            return {
              data: [messageRow({ id: "m7", bundle_id: null, text: "footer link is dead" })],
            };
          }
          return undefined;
        },
      );
      const body = await (await call("GET", "/ba1")).json();
      expect(body.items[0].messages.map((m: { text: string }) => m.text)).toEqual([
        "footer link is dead",
      ]);
    });

    it("refuses an empty batch", async () => {
      db = makeDb((op) => (op.table === "coach_people" ? { data: person } : undefined));
      const res = await call("POST", "", { personId: "p1", requestIds: [] });
      expect(res.status).toBe(400);
      expect(writes("coach_batches")).toEqual([]);
    });

    it("refuses a request that is not this client's", async () => {
      db = makeDb((op) => {
        if (op.table === "coach_people") return { data: person };
        if (op.table === "coach_requests") return { data: [] };
        return undefined;
      });
      const res = await call("POST", "", { personId: "p1", requestIds: ["someone-elses"] });
      expect(res.status).toBe(404);
      expect(writes("coach_batches")).toEqual([]);
    });

    it("404s for a client that is not this user's", async () => {
      const res = await call("POST", "", { personId: "nope", requestIds: ["r1"] });
      expect(res.status).toBe(404);
    });
  });

  describe("checking it", () => {
    it("shows each item beside what the client sent", async () => {
      db = withBatch(batchRow());
      const res = await call("GET", "/ba1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.batch).toMatchObject({ id: "ba1", itemCount: 1, uncheckedCount: 1 });
      expect(body.items[0]).toMatchObject({ id: "i1", state: "unchecked" });
      expect(body.items[0].messages[0].text).toBe("can the sconces go above the text on page 2");
    });

    it("ticks an item", async () => {
      db = withBatch(batchRow());
      const res = await call("PATCH", "/ba1/items/i1", { state: "done" });
      expect(res.status).toBe(200);
      expect(db.written("coach_batch_items", "update")[0]).toEqual({ state: "done" });
    });

    it("carries an item over with a note", async () => {
      db = withBatch(batchRow());
      await call("PATCH", "/ba1/items/i1", { state: "not_done", note: " Waiting on the file " });
      expect(db.written("coach_batch_items", "update")[0]).toEqual({
        state: "not_done",
        note: "Waiting on the file",
      });
    });

    it("refuses a state it does not know", async () => {
      db = withBatch(batchRow());
      expect((await call("PATCH", "/ba1/items/i1", { state: "maybe" })).status).toBe(400);
      expect(writes("coach_batch_items")).toEqual([]);
    });

    it("does not change a batch that was sent", async () => {
      db = withBatch(batchRow({ status: "sent", summary: SUMMARY }));
      expect((await call("PATCH", "/ba1/items/i1", { state: "done" })).status).toBe(409);
      expect(writes("coach_batch_items")).toEqual([]);
    });

    it("404s for a batch that is not this user's", async () => {
      db = withBatch(null, []);
      expect((await call("GET", "/nope")).status).toBe(404);
      expect((await call("PATCH", "/nope/items/i1", { state: "done" })).status).toBe(404);
    });
  });

  describe("the summary", () => {
    it("is not written while an item is unchecked", async () => {
      db = withBatch(batchRow());
      const res = await call("POST", "/ba1/summary");
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Check every item first" });
      expect(writeSummary).not.toHaveBeenCalled();
    });

    it("is written from the items, her words, the work and how the owner writes", async () => {
      db = withBatch(batchRow(), [itemRow({ state: "done" })], (op) => {
        if (op.table === "coach_messages" && eqValue(op, "direction") === "out") {
          return { data: [{ text: "ok on it, should be up tonight" }] };
        }
        return undefined;
      });
      writeSummary.mockResolvedValue(SUMMARY);
      const res = await call("POST", "/ba1/summary");
      expect(res.status).toBe(200);
      expect(writeSummary).toHaveBeenCalledWith({
        clientName: "Maren",
        projectName: "Alder House",
        items: [
          {
            label: "Move the sconces above the paragraph on page 2",
            asked: ["can the sconces go above the text on page 2"],
            work: ["Move the sconces up on page 2"],
            state: "done",
            note: null,
          },
        ],
        voice: ["ok on it, should be up tonight"],
      });
      expect(db.written("coach_batches", "update")[0]).toEqual({
        summary: SUMMARY,
        status: "ready",
      });
    });

    it("leaves the batch as it was when the model fails", async () => {
      db = withBatch(batchRow(), [itemRow({ state: "done" })]);
      writeSummary.mockRejectedValue(new Error("overloaded"));
      const res = await call("POST", "/ba1/summary");
      expect(res.status).toBe(502);
      expect(writes("coach_batches")).toEqual([]);
    });

    it("can be edited", async () => {
      db = withBatch(batchRow({ status: "ready", summary: SUMMARY }));
      const res = await call("PATCH", "/ba1", { summary: "  All live now.  " });
      expect(res.status).toBe(200);
      expect(db.written("coach_batches", "update")[0]).toEqual({ summary: "All live now." });
    });

    it("cannot be edited to nothing, or after it was sent", async () => {
      db = withBatch(batchRow({ status: "ready", summary: SUMMARY }));
      expect((await call("PATCH", "/ba1", { summary: "  " })).status).toBe(400);
      db = withBatch(batchRow({ status: "sent", summary: SUMMARY }));
      expect((await call("PATCH", "/ba1", { summary: "x" })).status).toBe(409);
      expect(writes("coach_batches")).toEqual([]);
    });
  });

  describe("sending", () => {
    it("is marked sent once there is a summary", async () => {
      db = withBatch(batchRow({ status: "ready", summary: SUMMARY }));
      const res = await call("POST", "/ba1/sent");
      expect(res.status).toBe(200);
      expect(db.written("coach_batches", "update")[0]).toMatchObject({ status: "sent" });
      expect(
        (db.written("coach_batches", "update")[0] as { sent_at: string }).sent_at,
      ).toBeTruthy();
    });

    it("cannot be marked sent without a summary", async () => {
      db = withBatch(batchRow());
      expect((await call("POST", "/ba1/sent")).status).toBe(409);
      expect(writes("coach_batches")).toEqual([]);
    });

    it("is marked sent when the Mac sees the summary go out to that client", async () => {
      db = withBatch(batchRow({ status: "ready", summary: SUMMARY }));
      await noteOutgoing("test-user-id", "p1", [`Hi! ${SUMMARY}`]);
      const update = writes("coach_batches")[0];
      expect(update.payload).toMatchObject({ status: "sent" });
      expect(eqValue(update, "id")).toBe("ba1");
      const read = db.ops.find((o) => o.table === "coach_batches" && o.action === "select")!;
      expect(eqValue(read, "person_id")).toBe("p1");
      expect(eqValue(read, "status")).toBe("ready");
    });

    it("ignores other messages going out", async () => {
      db = withBatch(batchRow({ status: "ready", summary: SUMMARY }));
      await noteOutgoing("test-user-id", "p1", ["running 10 min late"]);
      expect(writes("coach_batches")).toEqual([]);
    });
  });

  describe("removing", () => {
    it("deletes a batch that was not sent", async () => {
      db = withBatch(batchRow());
      expect((await call("DELETE", "/ba1")).status).toBe(200);
      expect(writes("coach_batches")[0].action).toBe("delete");
    });

    it("keeps a batch that was sent", async () => {
      db = withBatch(batchRow({ status: "sent", summary: SUMMARY }));
      expect((await call("DELETE", "/ba1")).status).toBe(409);
      expect(writes("coach_batches")).toEqual([]);
    });
  });

  describe("the list", () => {
    it("lists a client's batches, newest first, with how many are left to check", async () => {
      db = withBatch(batchRow(), [itemRow(), itemRow({ id: "i2", state: "done" })]);
      const res = await call("GET", "?personId=p1");
      expect(res.status).toBe(200);
      expect((await res.json()).batches[0]).toMatchObject({
        id: "ba1",
        itemCount: 2,
        uncheckedCount: 1,
      });
    });
  });
});
