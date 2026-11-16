import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../lib/storage.js", () => ({ signImageUrl: vi.fn(async () => null) }));
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_c: unknown, fn: unknown) => fn, send: vi.fn() },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const postBot = vi.fn();
vi.mock("../../services/coach/chat.js", () => ({
  postBotMessage: (...a: unknown[]) => postBot(...a),
}));

const { sweepRuns, sweepRunsJob, RUN_SWEEP_JOB, RUN_STALE_MS, RUN_UNCLAIMED_MS } =
  await import("../coachRuns.js");

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const row = (over: Record<string, unknown>) => ({
  id: "run1",
  user_id: "u1",
  task_id: "t1",
  pictures: [],
  created_at: ago(60 * 60_000),
  ...over,
});
const lt = (op: Op, col: string) => op.filters.find(([m, c]) => m === "lt" && c === col)?.[2];

/** A database that answers each query the way Postgres would for these rows. */
function world(rows: Record<string, unknown>[]) {
  return makeDb((op) => {
    if (op.table === "coach_tasks") return { data: { id: "t1", title: "Move the sconces up" } };
    if (op.table !== "coach_runs") return undefined;
    const status = eqValue(op, "status");
    if (op.action === "update") {
      const hit = rows.find((r) => r.id === eqValue(op, "id") && r.status === status);
      return { data: hit ? { ...hit, ...(op.payload as object) } : null };
    }
    const seenBefore = lt(op, "seen_at") as string | undefined;
    const madeBefore = lt(op, "created_at") as string | undefined;
    return {
      data: rows.filter(
        (r) =>
          r.status === status &&
          (!seenBefore || (r.seen_at as string) < seenBefore) &&
          (!madeBefore || (r.created_at as string) < madeBefore),
      ),
    };
  });
}

describe("runs nobody is looking after", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
    postBot.mockReset();
  });

  it("waits 15 minutes for a working runner and 30 for anyone to pick a run up", () => {
    expect(RUN_STALE_MS).toBe(15 * 60_000);
    expect(RUN_UNCLAIMED_MS).toBe(30 * 60_000);
    expect(RUN_SWEEP_JOB).toMatchObject({
      id: "coach-runs-sweep",
      triggers: [{ cron: "*/5 * * * *" }],
    });
  });

  it("fails a working run whose runner has been silent for 16 minutes, and says so", async () => {
    db = world([row({ status: "working", seen_at: ago(16 * 60_000) })]);
    expect(await sweepRuns(NOW)).toEqual({ failed: 1, quiet: 0 });

    const update = db.ops.find((o) => o.table === "coach_runs" && o.action === "update")!;
    expect(update.payload).toMatchObject({
      status: "failed",
      error: "The runner stopped responding.",
    });
    expect(eqValue(update, "status")).toBe("working");
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "run_finished",
        refId: "run1",
        text: "That didn't work: The runner stopped responding.",
      }),
    );
  });

  it("leaves a run whose runner checked in 14 minutes ago", async () => {
    db = world([row({ status: "working", seen_at: ago(14 * 60_000) })]);
    expect(await sweepRuns(NOW)).toEqual({ failed: 0, quiet: 0 });
    expect(db.written("coach_runs")).toEqual([]);
    expect(postBot).not.toHaveBeenCalled();
  });

  it("says nothing when the runner finished the run in the meantime", async () => {
    const rows = [row({ status: "working", seen_at: ago(16 * 60_000) })];
    db = world(rows);
    db.respond = ((inner) => (op: Op) => {
      if (op.table === "coach_runs" && op.action === "update") return { data: null };
      return inner(op);
    })(db.respond);
    expect(await sweepRuns(NOW)).toEqual({ failed: 0, quiet: 0 });
    expect(postBot).not.toHaveBeenCalled();
  });

  it("says the runner seems to be off for a run still waiting after 31 minutes", async () => {
    db = world([row({ status: "queued", created_at: ago(31 * 60_000) })]);
    expect(await sweepRuns(NOW)).toEqual({ failed: 0, quiet: 1 });
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kind: "runner_quiet", refId: "run1" }),
    );
    expect(db.written("coach_runs")).toEqual([]); // It stays queued for when the runner is back.
  });

  it("says nothing about a run that has waited 29 minutes", async () => {
    db = world([row({ status: "queued", created_at: ago(29 * 60_000) })]);
    expect(await sweepRuns(NOW)).toEqual({ failed: 0, quiet: 0 });
    expect(postBot).not.toHaveBeenCalled();
  });

  it("runs as a job", async () => {
    db = world([]);
    const step = { run: async (_n: string, fn: () => Promise<unknown>) => fn() };
    const result = await (sweepRunsJob as unknown as (a: unknown) => Promise<unknown>)({ step });
    expect(result).toEqual({ failed: 0, quiet: 0 });
  });
});
