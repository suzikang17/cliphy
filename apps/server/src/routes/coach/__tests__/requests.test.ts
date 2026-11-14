import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import type { CoachTask } from "@cliphy/shared";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
const inngestSend = vi.fn();
vi.mock("../../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown) => app().request(path, json("POST", body));

const proposedTasks = [
  {
    kind: "ask",
    title: "Words or type?",
    withPerson: true,
    after: null,
    answersQuestion: true,
    kit: {},
  },
  {
    kind: "do",
    title: "Replace page 2 copy",
    withPerson: false,
    after: 0,
    answersQuestion: false,
    kit: {},
  },
  {
    kind: "tell",
    title: "Tell Maren it's live",
    withPerson: true,
    after: 1,
    answersQuestion: false,
    kit: {},
  },
];

const requestRow = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  bundle_id: "b1",
  person_id: "p1",
  project_id: "pr1",
  understood: "Maren asked to replace the page 2 text.",
  open_question: { text: "Words or type?", options: ["Only words", "Type too"] },
  status: "new",
  proposed_replaces_id: "r-2022",
  proposed_tasks: proposedTasks,
  due_date: "2026-11-18",
  created_at: "2026-11-14T09:44:00Z",
  ...over,
});

/** A database holding one request; inserted tasks get ids t1, t2, … */
function requestDb(
  row: Record<string, unknown> | null = requestRow(),
  existingTasks: unknown[] = [],
) {
  let n = 0;
  return makeDb((op: Op) => {
    if (op.table === "coach_requests" && op.action === "select") {
      if (!op.single) return { data: row ? [row] : [] };
      if (eqValue(op, "id") === "r-2022") {
        return {
          data: requestRow({ id: "r-2022", status: "confirmed", proposed_replaces_id: null }),
        };
      }
      return { data: row };
    }
    if (op.table === "coach_requests" && op.action === "update") {
      const p = op.payload as Record<string, unknown>;
      // The guarded status change only matches a request that is still new.
      if (p.status === "confirmed")
        return { data: row?.status === "new" ? { ...row, ...p } : null };
      return { data: null };
    }
    if (op.table === "coach_tasks" && op.action === "insert") {
      return { data: { id: `t${++n}`, state: "open", created_at: "x", ...(op.payload as object) } };
    }
    if (op.table === "coach_tasks") return { data: existingTasks };
    if (op.table === "coach_projects") return { data: { id: "pr2" } };
    if (op.table === "coach_messages") {
      return {
        data: [
          {
            id: "m1",
            person_id: "p1",
            channel: "imessage",
            direction: "in",
            text: "",
            attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
            sent_at: "2026-11-14T09:42:00Z",
          },
        ],
      };
    }
    return undefined;
  });
}

const statusUpdates = () =>
  db.ops.filter((o) => o.table === "coach_requests" && o.action === "update");

describe("coach requests", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Requests");
    inngestSend.mockReset();
    db = requestDb();
  });

  it("confirming with an answer creates do and tell, and marks the old request replaced", async () => {
    const res = await post("/api/coach/requests/r1/confirm", { answer: " Only the words " });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.request).toMatchObject({
      status: "confirmed",
      answer: "Only the words",
      replacesId: "r-2022",
    });
    expect(body.tasks.map((t: CoachTask) => t.kind)).toEqual(["do", "tell"]);
    expect(body.tasks.map((t: CoachTask) => t.blocked)).toEqual([false, true]);

    const replaced = statusUpdates().find(
      (o) => (o.payload as { status: string }).status === "replaced",
    );
    expect(eqValue(replaced!, "id")).toBe("r-2022");
    expect(eqValue(replaced!, "user_id")).toBe("test-user-id");
  });

  it("links the chain, the person and the project, and puts the due date on the work", async () => {
    await post("/api/coach/requests/r1/confirm", { answer: "Only the words" });
    const [doTask, tellTask] = db.written("coach_tasks", "insert") as Record<string, unknown>[];
    expect(doTask).toMatchObject({
      user_id: "test-user-id",
      request_id: "r1",
      project_id: "pr1",
      kind: "do",
      after_task_id: null,
      with_person_id: null,
      due_date: "2026-11-18",
    });
    expect(tellTask).toMatchObject({
      kind: "tell",
      after_task_id: "t1",
      with_person_id: "p1",
      due_date: null,
    });
  });

  it("keeps the ask when confirmed without an answer", async () => {
    const res = await post("/api/coach/requests/r1/confirm", {});
    const kinds = (await res.json()).tasks.map((t: CoachTask) => t.kind);
    expect(kinds).toEqual(["ask", "do", "tell"]);
  });

  it("does not replace when replaces is false", async () => {
    const res = await post("/api/coach/requests/r1/confirm", { replaces: false });
    expect((await res.json()).request.replacesId).toBeNull();
    expect(
      statusUpdates().some((o) => (o.payload as { status: string }).status === "replaced"),
    ).toBe(false);
  });

  it("files under a different project when one is given", async () => {
    await post("/api/coach/requests/r1/confirm", { projectId: "pr2" });
    const confirm = statusUpdates()[0].payload as Record<string, unknown>;
    expect(confirm.project_id).toBe("pr2");
  });

  it("only changes a request that is still new", async () => {
    await post("/api/coach/requests/r1/confirm", {});
    expect(statusUpdates()[0].filters).toContainEqual(["eq", "status", "new"]);
  });

  // Review Focus 4: confirm tapped twice.
  it("a second confirm creates no more tasks", async () => {
    db = requestDb(requestRow({ status: "confirmed" }), [
      { id: "t1", kind: "do", state: "open", title: "Replace page 2 copy", request_id: "r1" },
    ]);
    const res = await post("/api/coach/requests/r1/confirm", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.status).toBe("confirmed");
    expect(body.tasks).toHaveLength(1);
    expect(db.writtenTables()).toEqual([]);
  });

  it("creates no tasks when another confirm wins the race", async () => {
    // Read as new, but the guarded update matches nothing.
    db = makeDb((op: Op) => {
      if (op.table === "coach_requests" && op.action === "select") return { data: requestRow() };
      if (op.table === "coach_tasks") return { data: [] };
      return { data: null };
    });
    const res = await post("/api/coach/requests/r1/confirm", {});
    expect(res.status).toBe(200);
    expect(db.written("coach_tasks", "insert")).toEqual([]);
  });

  it("404s a request that is not the caller's", async () => {
    db = requestDb(null);
    expect((await post("/api/coach/requests/nope/confirm", {})).status).toBe(404);
  });

  it("fix requires a note", async () => {
    expect((await post("/api/coach/requests/r1/fix", { note: " " })).status).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("fix refuses a request that is no longer new", async () => {
    db = requestDb(requestRow({ status: "confirmed" }));
    expect((await post("/api/coach/requests/r1/fix", { note: "It's the homepage" })).status).toBe(
      409,
    );
  });

  it("fix removes the misread request and asks for the bundle to be read again with the note", async () => {
    const res = await post("/api/coach/requests/r1/fix", { note: "It's the homepage" });
    expect(res.status).toBe(202);
    expect(db.ops.some((o) => o.table === "coach_requests" && o.action === "delete")).toBe(true);
    expect(db.written("coach_bundles", "update")[0]).toEqual({
      fix_note: "It's the homepage",
      status: "collecting",
      kind: null,
    });
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.fix",
      data: { bundleId: "b1", userId: "test-user-id" },
    });
  });

  it("shows a request with its messages, signed attachment links and what it would replace", async () => {
    const res = await app().request("/api/coach/requests/r1");
    const body = await res.json();
    expect(body.request.id).toBe("r1");
    expect(body.messages[0].attachments[0].url).toBe("https://signed/coach/test-user-id/a.png");
    expect(body.replaces.id).toBe("r-2022");
  });

  it("lists requests, filtered by status when asked", async () => {
    const res = await app().request("/api/coach/requests?status=new");
    expect((await res.json()).requests).toHaveLength(1);
    expect(db.ops[0].filters).toContainEqual(["eq", "status", "new"]);
  });

  it("rejects an unknown status filter", async () => {
    expect((await app().request("/api/coach/requests?status=banana")).status).toBe(400);
  });

  it("returns a project's history with replaced requests nested", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "coach_projects") return { data: { id: "pr1" } };
      if (op.table === "coach_requests") {
        return {
          data: [
            requestRow({
              id: "r2",
              status: "confirmed",
              replaces_id: "r1",
              created_at: "2026-11-14T00:00:00Z",
            }),
            requestRow({ id: "r1", status: "replaced", created_at: "2022-03-01T00:00:00Z" }),
          ],
        };
      }
      return undefined;
    });
    const res = await app().request("/api/coach/projects/pr1/history");
    const { entries } = await res.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].request.id).toBe("r2");
    expect(entries[0].replaced[0].id).toBe("r1");
  });

  it("404s history for a project that is not the caller's", async () => {
    db = makeDb(() => ({ data: null }));
    expect((await app().request("/api/coach/projects/nope/history")).status).toBe(404);
  });
});
