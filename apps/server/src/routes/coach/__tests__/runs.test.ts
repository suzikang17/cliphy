import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
let who: "jwt" | "api_key";
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set("userId", "test-user-id");
    c.set("authMethod", who);
    await next();
  },
}));
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown = {}) => app().request(path, json("POST", body));

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  request_id: "r1",
  project_id: "pr1",
  kind: "do",
  state: "open",
  title: "Move the sconces up on page 2",
  kit: { doneWhen: "The sconce photos sit above the paragraph." },
  after_task_id: null,
  created_at: "2026-11-14T10:00:00Z",
  ...over,
});
const projectRow = {
  id: "pr1",
  repo: "example/alder-house",
  site_url: "https://alderhouse.example",
};
const runRow = (over: Record<string, unknown> = {}) => ({
  id: "run1",
  user_id: "test-user-id",
  task_id: "t1",
  status: "queued",
  pictures: [],
  created_at: "2026-11-15T09:00:00Z",
  ...over,
});
const has = (op: Op, method: string, col: string) =>
  op.filters.find(([m, c]) => m === method && c === col)?.[2];
const runWrites = () => db.ops.filter((o) => o.table === "coach_runs" && o.action !== "select");

/** A database holding these tasks and the Alder House project. */
function withTasks(tasks: Record<string, unknown>[], more: (op: Op) => unknown = () => undefined) {
  return makeDb((op) => {
    const extra = more(op);
    if (extra !== undefined) return extra as { data?: unknown; error?: unknown };
    if (op.table === "coach_tasks") return { data: op.single ? tasks[0] : tasks };
    if (op.table === "coach_projects") return { data: projectRow };
    return undefined;
  });
}

describe("runs: the website task runner's calls", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
    db = makeDb();
    who = "jwt";
  });

  describe("starting one from the phone", () => {
    it("queues a run for work that can be started on the site", async () => {
      db = withTasks([taskRow()], (op) =>
        op.table === "coach_runs" && op.action === "insert" ? { data: runRow() } : undefined,
      );
      const res = await post("/api/coach/runs", { taskId: "t1" });
      expect(res.status).toBe(201);
      expect((await res.json()).run).toMatchObject({ id: "run1", taskId: "t1", status: "queued" });
      expect(db.written("coach_runs", "insert")[0]).toEqual({
        user_id: "test-user-id",
        task_id: "t1",
      });
    });

    it("refuses a task that is not work, is blocked, or has no repo", async () => {
      const cases: [string, FakeDb][] = [
        ["tell", withTasks([taskRow({ kind: "tell" })])],
        ["blocked", withTasks([taskRow({ after_task_id: "t0" }), taskRow({ id: "t0" })])],
        [
          "no repo",
          withTasks([taskRow()], (op) =>
            op.table === "coach_projects" ? { data: { id: "pr1", repo: null } } : undefined,
          ),
        ],
      ];
      for (const [name, fake] of cases) {
        db = fake;
        const res = await post("/api/coach/runs", { taskId: "t1" });
        expect(res.status, name).toBe(409);
        expect(await res.json()).toEqual({ error: "This task cannot be started on the site" });
        expect(runWrites(), name).toEqual([]);
      }
    });

    it("404s for a task that is not this user's", async () => {
      db = withTasks([]);
      expect((await post("/api/coach/runs", { taskId: "nope" })).status).toBe(404);
    });

    it("gives back the run already going instead of starting a second", async () => {
      db = withTasks([taskRow()], (op) => {
        if (op.table !== "coach_runs") return undefined;
        if (op.action === "insert") return { data: null, error: { code: "23505" } };
        return { data: runRow({ status: "working" }) };
      });
      const res = await post("/api/coach/runs", { taskId: "t1" });
      expect(res.status).toBe(200);
      expect((await res.json()).run.status).toBe("working");
      expect(db.written("coach_runs", "insert")).toHaveLength(1);
    });

    it("cannot be done with an API key", async () => {
      who = "api_key";
      db = withTasks([taskRow()]);
      const res = await post("/api/coach/runs", { taskId: "t1" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Sign in on the phone to do this" });
      expect(db.ops).toEqual([]);
    });
  });

  describe("claiming", () => {
    beforeEach(() => {
      who = "api_key";
    });

    const claimDb = (opts: { lose?: number; request?: boolean } = {}) => {
      let lost = 0;
      return makeDb((op) => {
        if (op.table === "coach_runs" && op.action === "select") {
          return { data: { id: "run1" } };
        }
        if (op.table === "coach_runs" && op.action === "update") {
          if (lost < (opts.lose ?? 0)) {
            lost += 1;
            return { data: null };
          }
          return { data: runRow({ status: "working" }) };
        }
        if (op.table === "coach_tasks") {
          return { data: taskRow(opts.request === false ? { request_id: null } : {}) };
        }
        if (op.table === "coach_projects") return { data: projectRow };
        if (op.table === "coach_requests") {
          return {
            data: {
              id: "r1",
              bundle_id: "b1",
              understood: "Maren asked for the sconces to move up on page 2.",
              answer: "Only the photos",
            },
          };
        }
        if (op.table === "coach_messages") {
          return {
            data: [
              {
                direction: "in",
                text: "can the sconces go higher on page 2",
                sent_at: "2026-11-14T09:00:00Z",
                attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
              },
              { direction: "out", text: "sure", sent_at: "2026-11-14T09:01:00Z", attachments: [] },
            ],
          };
        }
        return undefined;
      });
    };

    it("takes the oldest queued run, guarded so only one caller can", async () => {
      db = claimDb();
      const res = await post("/api/coach/runs/claim");
      expect(res.status).toBe(200);
      const update = runWrites()[0];
      expect(update.payload).toMatchObject({ status: "working" });
      expect(update.payload).toHaveProperty("claimed_at");
      expect(update.payload).toHaveProperty("seen_at");
      expect(eqValue(update, "status")).toBe("queued");
      expect(eqValue(update, "user_id")).toBe("test-user-id");
    });

    it("hands over the brief: repo, the request as understood, the task and the messages", async () => {
      db = claimDb();
      const { run, brief } = await (await post("/api/coach/runs/claim")).json();
      expect(run.id).toBe("run1");
      expect(brief).toEqual({
        runId: "run1",
        repo: "example/alder-house",
        siteUrl: "https://alderhouse.example",
        understood: "Maren asked for the sconces to move up on page 2.",
        answer: "Only the photos",
        task: {
          title: "Move the sconces up on page 2",
          kit: { doneWhen: "The sconce photos sit above the paragraph." },
        },
        messages: [
          {
            direction: "in",
            text: "can the sconces go higher on page 2",
            sentAt: "2026-11-14T09:00:00Z",
            imageUrls: ["https://signed/coach/test-user-id/a.png"],
          },
          { direction: "out", text: "sure", sentAt: "2026-11-14T09:01:00Z", imageUrls: [] },
        ],
      });
    });

    it("a task made by hand has no request and no messages in its brief", async () => {
      db = claimDb({ request: false });
      const { brief } = await (await post("/api/coach/runs/claim")).json();
      expect(brief).toMatchObject({ understood: "", answer: null, messages: [] });
      expect(db.ops.some((o) => o.table === "coach_messages")).toBe(false);
    });

    it("tries the next run when another runner took this one", async () => {
      db = claimDb({ lose: 1 });
      const { run } = await (await post("/api/coach/runs/claim")).json();
      expect(run.id).toBe("run1");
      expect(runWrites()).toHaveLength(2);
    });

    it("says there is nothing when nothing is queued", async () => {
      db = makeDb();
      const res = await post("/api/coach/runs/claim");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ run: null });
    });

    it("gives up, with nothing, after losing three times", async () => {
      db = claimDb({ lose: 5 });
      expect(await (await post("/api/coach/runs/claim")).json()).toEqual({ run: null });
      expect(runWrites()).toHaveLength(3);
    });

    it("is not for the phone", async () => {
      who = "jwt";
      const res = await post("/api/coach/runs/claim");
      expect(res.status).toBe(403);
      expect(db.ops).toEqual([]);
    });
  });

  describe("checking in", () => {
    beforeEach(() => {
      who = "api_key";
    });

    it("records that the runner is alive and what it is doing", async () => {
      db = makeDb((op) => (op.action === "update" ? { data: { id: "run1" } } : undefined));
      const res = await post("/api/coach/runs/run1/checkin", { note: "building" });
      expect(await res.json()).toEqual({ cancelled: false });
      const update = runWrites()[0];
      expect(update.payload).toMatchObject({ note: "building" });
      expect(update.payload).toHaveProperty("seen_at");
      expect(eqValue(update, "status")).toBe("working");
    });

    it("tells the runner to stop when the run was cancelled, and leaves it alone", async () => {
      db = makeDb((op) => (op.action === "select" ? { data: { status: "cancelled" } } : undefined));
      const res = await post("/api/coach/runs/run1/checkin", {});
      expect(await res.json()).toEqual({ cancelled: true });
    });

    it("404s for a run that does not exist", async () => {
      expect((await post("/api/coach/runs/nope/checkin", {})).status).toBe(404);
    });
  });

  describe("finishing", () => {
    beforeEach(() => {
      who = "api_key";
    });
    const done = {
      status: "done",
      summary: "Moved the sconce photos above the paragraph on the Lighting page.",
      branch: "cliphy/run1-move-the-sconces-up",
      prUrl: "https://github.com/example/alder-house/pull/3",
      previewUrl: "https://run1.alder-house.pages.dev",
      pictures: [{ label: "after", width: "phone", storagePath: "coach/test-user-id/after.png" }],
    };

    it("stores the outcome on a run that is still going", async () => {
      db = makeDb((op) =>
        op.action === "update"
          ? { data: runRow({ status: "done", summary: done.summary }) }
          : undefined,
      );
      const res = await post("/api/coach/runs/run1/finish", done);
      expect(res.status).toBe(200);
      expect((await res.json()).run.status).toBe("done");
      const update = runWrites()[0];
      expect(update.payload).toMatchObject({
        status: "done",
        summary: done.summary,
        branch: done.branch,
        pr_url: done.prUrl,
        preview_url: done.previewUrl,
        pictures: done.pictures,
      });
      expect(update.payload).toHaveProperty("finished_at");
      expect(has(update, "in", "status")).toEqual(["queued", "working"]);
    });

    it("a second finish, or one after Stop, changes nothing and is not an error", async () => {
      db = makeDb((op) =>
        op.action === "select" ? { data: runRow({ status: "cancelled" }) } : undefined,
      );
      const res = await post("/api/coach/runs/run1/finish", done);
      expect(res.status).toBe(200);
      expect((await res.json()).run.status).toBe("cancelled");
      expect(runWrites()).toHaveLength(1); // the guarded update that matched nothing
    });

    it("refuses an outcome it does not know, before touching anything", async () => {
      const res = await post("/api/coach/runs/run1/finish", { ...done, status: "merged" });
      expect(res.status).toBe(400);
      expect(db.ops).toEqual([]);
    });

    it("refuses a picture stored outside this user's own folder", async () => {
      for (const storagePath of ["coach/someone-else/x.png", "coach/test-user-id/../x.png"]) {
        const res = await post("/api/coach/runs/run1/finish", {
          ...done,
          pictures: [{ label: "after", width: "phone", storagePath }],
        });
        expect(res.status, storagePath).toBe(400);
      }
      expect(db.ops).toEqual([]);
    });

    it("cuts a very long summary or error", async () => {
      db = makeDb((op) =>
        op.action === "update" ? { data: runRow({ status: "failed" }) } : undefined,
      );
      await post("/api/coach/runs/run1/finish", { status: "failed", error: "x".repeat(5000) });
      expect((runWrites()[0].payload as { error: string }).error).toHaveLength(2000);
    });

    it("404s for a run that does not exist", async () => {
      expect((await post("/api/coach/runs/nope/finish", done)).status).toBe(404);
    });
  });

  describe("stopping one from the phone", () => {
    it("cancels a run that is still going", async () => {
      db = makeDb((op) =>
        op.action === "update" ? { data: runRow({ status: "cancelled" }) } : undefined,
      );
      const res = await post("/api/coach/runs/run1/cancel");
      expect((await res.json()).run.status).toBe("cancelled");
      const update = runWrites()[0];
      expect(update.payload).toMatchObject({ status: "cancelled" });
      expect(update.payload).toHaveProperty("finished_at");
      expect(has(update, "in", "status")).toEqual(["queued", "working"]);
    });

    it("gives back a finished run unchanged", async () => {
      db = makeDb((op) =>
        op.action === "select" ? { data: runRow({ status: "done" }) } : undefined,
      );
      expect((await (await post("/api/coach/runs/run1/cancel")).json()).run.status).toBe("done");
    });

    it("is not for an API key", async () => {
      who = "api_key";
      expect((await post("/api/coach/runs/run1/cancel")).status).toBe(403);
    });
  });

  it("reads the newest run for a task, with picture addresses", async () => {
    db = makeDb((op) =>
      op.table === "coach_runs"
        ? {
            data: runRow({
              status: "done",
              pictures: [
                { label: "after", width: "phone", storagePath: "coach/test-user-id/a.png" },
              ],
            }),
          }
        : undefined,
    );
    const { run } = await (await app().request("/api/coach/runs?taskId=t1")).json();
    expect(run.pictures[0].url).toBe("https://signed/coach/test-user-id/a.png");
    expect(eqValue(db.ops[0], "task_id")).toBe("t1");
    expect(eqValue(db.ops[0], "user_id")).toBe("test-user-id");
  });

  it("reads null when the task has never been run", async () => {
    expect(await (await app().request("/api/coach/runs?taskId=t1")).json()).toEqual({ run: null });
  });
});
