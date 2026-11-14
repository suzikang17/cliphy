import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb, type Op } from "../../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const logError = vi.fn();
vi.mock("../../../lib/logger.js", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => logError(...a) }),
  },
}));

const { syncTaskReminders, loadSettings } = await import("../reminders.js");

// Saturday 14 Nov 2026, 10:00 in Los Angeles.
const now = new Date("2026-11-14T18:00:00Z");
const settingsRow = {
  timezone: "America/Los_Angeles",
  quiet_start: "21:00:00",
  quiet_end: "08:00:00",
  review_dow: 0,
  review_time: "18:00:00",
};

function reminderDb(tasks: Record<string, unknown>[], existing: Record<string, unknown>[] = []) {
  return makeDb((op: Op) => {
    if (op.table === "coach_tasks") return { data: tasks };
    if (op.table === "coach_settings") return { data: settingsRow };
    if (op.table === "coach_reminders" && op.action === "select") return { data: existing };
    return undefined;
  });
}

const upserted = () =>
  (db.written("coach_reminders", "upsert")[0] as Record<string, unknown>[]) ?? [];
const cancels = () => db.ops.filter((o) => o.table === "coach_reminders" && o.action === "update");

describe("syncTaskReminders", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
  });

  it("schedules the planned reminders for an open dated task", async () => {
    db = reminderDb([{ id: "t1", state: "open", due_date: "2026-11-18", due_time: null }]);
    await syncTaskReminders("u1", ["t1"], now);
    expect(upserted().map((r) => [r.kind, r.fire_at, r.status])).toEqual([
      ["day_before", "2026-11-17T17:00:00.000Z", "scheduled"],
      ["morning_of", "2026-11-18T17:00:00.000Z", "scheduled"],
    ]);
    expect(upserted()[0]).toMatchObject({
      user_id: "u1",
      task_id: "t1",
      resends: 0,
      sent_at: null,
    });
    const op = db.ops.find((o) => o.table === "coach_reminders" && o.action === "upsert");
    expect(op?.options).toMatchObject({ onConflict: "task_id,kind" });
  });

  it("writes nothing for an undated task with no reminders", async () => {
    db = reminderDb([{ id: "t1", state: "open", due_date: null, due_time: null }]);
    await syncTaskReminders("u1", ["t1"], now);
    expect(db.writtenTables()).toEqual([]);
  });

  // Review Focus 1: the date moves.
  it("re-times reminders when the date moves, leaving none at the old time", async () => {
    db = reminderDb(
      [{ id: "t1", state: "open", due_date: "2026-11-20", due_time: null }],
      [
        {
          id: "r1",
          task_id: "t1",
          kind: "day_before",
          fire_at: "2026-11-17T17:00:00+00:00",
          status: "scheduled",
        },
        {
          id: "r2",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-18T17:00:00+00:00",
          status: "scheduled",
        },
      ],
    );
    await syncTaskReminders("u1", ["t1"], now);
    expect(upserted().map((r) => [r.kind, r.fire_at])).toEqual([
      ["day_before", "2026-11-19T17:00:00.000Z"],
      ["morning_of", "2026-11-20T17:00:00.000Z"],
    ]);
  });

  it("cancels a kind that is no longer planned, such as the due-time reminder when the time is removed", async () => {
    db = reminderDb(
      [{ id: "t1", state: "open", due_date: "2026-11-18", due_time: null }],
      [
        {
          id: "r3",
          task_id: "t1",
          kind: "at_time",
          fire_at: "2026-11-18T22:00:00+00:00",
          status: "scheduled",
        },
      ],
    );
    await syncTaskReminders("u1", ["t1"], now);
    expect(cancels()).toHaveLength(1);
    expect(cancels()[0].payload).toEqual({ status: "cancelled" });
    expect(eqValue(cancels()[0], "id")).toBe("r3");
  });

  // Review Focus 1: the task is finished.
  it("cancels every pending reminder when the task is done or dropped", async () => {
    for (const state of ["done", "dropped"]) {
      db = reminderDb(
        [{ id: "t1", state, due_date: "2026-11-18", due_time: null }],
        [
          {
            id: "r1",
            task_id: "t1",
            kind: "day_before",
            fire_at: "2026-11-17T17:00:00+00:00",
            status: "sent",
          },
          {
            id: "r2",
            task_id: "t1",
            kind: "morning_of",
            fire_at: "2026-11-18T17:00:00+00:00",
            status: "scheduled",
          },
          {
            id: "r0",
            task_id: "t1",
            kind: "at_time",
            fire_at: "2026-11-18T22:00:00+00:00",
            status: "acked",
          },
        ],
      );
      await syncTaskReminders("u1", ["t1"], now);
      expect(upserted()).toEqual([]);
      expect(
        cancels()
          .map((o) => eqValue(o, "id"))
          .sort(),
      ).toEqual(["r1", "r2"]);
    }
  });

  it("leaves a reminder alone when its time has not changed, so it is not sent twice", async () => {
    db = reminderDb(
      [{ id: "t1", state: "open", due_date: "2026-11-18", due_time: null }],
      [
        {
          id: "r1",
          task_id: "t1",
          kind: "day_before",
          fire_at: "2026-11-17T17:00:00+00:00",
          status: "sent",
        },
        {
          id: "r2",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-18T17:00:00+00:00",
          status: "scheduled",
        },
      ],
    );
    await syncTaskReminders("u1", ["t1"], now);
    expect(db.writtenTables()).toEqual([]);
  });

  // An acked 09:00 reminder for a task due today must not come back when
  // something unrelated re-syncs (quiet hours changed, a message was sent).
  it("does not re-fire a task due today that has already been reminded", async () => {
    db = reminderDb(
      [{ id: "t1", state: "open", due_date: "2026-11-14", due_time: null }],
      [
        {
          id: "r2",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
          status: "acked",
        },
      ],
    );
    await syncTaskReminders("u1", ["t1"], now);
    expect(db.writtenTables()).toEqual([]);
  });

  it("plans nothing until the user's timezone is known, so nothing fires at the wrong hour", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "coach_tasks")
        return { data: [{ id: "t1", state: "open", due_date: "2026-11-18", due_time: null }] };
      if (op.table === "coach_settings") return { data: { timezone: null } };
      return { data: [] };
    });
    expect(await syncTaskReminders("u1", ["t1"], now)).toBe(true);
    expect(db.writtenTables()).toEqual([]);
  });

  it("reports and logs a failed write instead of pretending the reminders exist", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "coach_tasks")
        return { data: [{ id: "t1", state: "open", due_date: "2026-11-18", due_time: null }] };
      if (op.table === "coach_settings") return { data: settingsRow };
      if (op.table === "coach_reminders" && op.action === "upsert")
        return { data: null, error: { message: "boom" } };
      return { data: [] };
    });
    expect(await syncTaskReminders("u1", ["t1"], now)).toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it("reports a failed task load", async () => {
    db = makeDb((op: Op) =>
      op.table === "coach_tasks" ? { data: null, error: { message: "boom" } } : { data: [] },
    );
    expect(await syncTaskReminders("u1", ["t1"], now)).toBe(false);
  });

  it("keeps reminding a task that is waiting on someone", async () => {
    db = reminderDb([{ id: "t1", state: "waiting", due_date: "2026-11-18", due_time: null }]);
    await syncTaskReminders("u1", ["t1"], now);
    expect(upserted()).toHaveLength(2);
  });

  it("does nothing for an empty list of tasks", async () => {
    db = reminderDb([]);
    await syncTaskReminders("u1", [], now);
    expect(db.ops).toEqual([]);
  });

  it("loads settings with defaults when the user has none", async () => {
    db = makeDb(() => ({ data: null }));
    expect(await loadSettings("u1")).toEqual({
      timezoneSet: false,
      timezone: "UTC",
      quietStart: "21:00",
      quietEnd: "08:00",
      reviewDow: 0,
      reviewTime: "18:00",
    });
  });

  it("loads stored settings with times as HH:MM", async () => {
    db = reminderDb([]);
    expect(await loadSettings("u1")).toMatchObject({
      timezone: "America/Los_Angeles",
      quietStart: "21:00",
      quietEnd: "08:00",
    });
  });
});
