import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_c: unknown, fn: unknown) => fn, send: vi.fn() },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const sendPush = vi.fn();
vi.mock("../../services/push.js", () => ({ sendPush: (...a: unknown[]) => sendPush(...a) }));

const postBot = vi.fn();
vi.mock("../../services/coach/chat.js", () => ({
  postBotMessage: (...a: unknown[]) => postBot(...a),
}));
const syncReminders = vi.fn();
vi.mock("../../services/coach/reminders.js", async (orig) => ({
  ...(await orig<typeof import("../../services/coach/reminders.js")>()),
  syncTaskReminders: (...a: unknown[]) => syncReminders(...a),
}));

const { fireReminders, weeklyReview, reconcileReminders, FIRE_JOB } =
  await import("../coachReminders.js");

// Saturday 14 Nov 2026, 09:00 in Los Angeles.
const NOW = "2026-11-14T17:00:00.000Z";
const steps: string[] = [];
const step = {
  run: async (name: string, fn: () => Promise<unknown>) => {
    steps.push(name);
    return fn();
  },
};
const fire = () =>
  (fireReminders as unknown as (a: unknown) => Promise<Record<string, number>>)({ step });
const review = () =>
  (weeklyReview as unknown as (a: unknown) => Promise<{ sent: number }>)({ step });

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Homepage photo swap",
  kind: "do",
  state: "open",
  due_time: null,
  with_person_id: "p1",
  request_id: "r1",
  ...over,
});
const settingsRow = (over: Record<string, unknown> = {}) => ({
  user_id: "u1",
  timezone: "America/Los_Angeles",
  quiet_start: "21:00:00",
  quiet_end: "08:00:00",
  review_dow: 6,
  review_time: "09:00:00",
  last_review_at: null,
  push_failures: 0,
  ...over,
});

interface World {
  due?: Record<string, unknown>[]; // rows the claim returns
  pending?: Record<string, unknown>[]; // sent/delivered rows awaiting an answer
  task?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  users?: { id: string }[];
  undated?: { id: string }[];
}
function world(w: World = {}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_reminders" && op.action === "update") {
      // The claim is the update that moves scheduled → sent.
      const claim = eqValue(op, "status") === "scheduled";
      return { data: claim ? (w.due ?? []) : null };
    }
    if (op.table === "coach_reminders" && op.action === "select") return { data: w.pending ?? [] };
    if (op.table === "coach_tasks" && op.single)
      return { data: w.task === undefined ? task() : w.task };
    if (op.table === "coach_tasks") return { data: w.undated ?? [] };
    if (op.table === "coach_people") return { data: { name: "Maren" } };
    if (op.table === "coach_settings" && op.action === "select") {
      return { data: w.settings === undefined ? settingsRow() : w.settings };
    }
    if (op.table === "users") return { data: w.users ?? [] };
    return undefined;
  });
}
const reminderUpdates = () =>
  db.ops.filter((o) => o.table === "coach_reminders" && o.action === "update");

describe("coach fireReminders", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    sendPush.mockReset();
    postBot.mockReset();
    sendPush.mockResolvedValue({ sent: 1, dead: 0 });
    steps.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("claims due reminders in one guarded update, then sends each with who asked and by when", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    const out = await fire();
    expect(out.sent).toBe(1);

    const claim = reminderUpdates()[0];
    expect(claim.payload).toEqual({ status: "sent", sent_at: NOW });
    expect(claim.filters).toContainEqual(["eq", "status", "scheduled"]);
    expect(claim.filters).toContainEqual(["lte", "fire_at", NOW]);

    expect(sendPush).toHaveBeenCalledWith("u1", {
      title: "Homepage photo swap",
      body: "Maren asked for this by today.",
      data: { type: "reminder", reminderId: "r1", taskId: "t1" },
    });
  });

  // Review Focus 4: an overlap or retry must not send twice.
  it("sends each reminder in its own step, so a retry does not repeat ones already sent", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
        { id: "r2", user_id: "u1", task_id: "t1", kind: "at_time" },
      ],
    });
    await fire();
    expect(steps).toEqual(["claim", "send-r1", "send-r2", "resend"]);
    expect(FIRE_JOB).toMatchObject({ concurrency: 1, triggers: [{ cron: "* * * * *" }] });
  });

  it("puts every reminder it sends into the chat thread too, with buttons", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    await fire();
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "reminder",
        refId: "r1:2026-11-14T17:00:00+00:00",
        text: "Homepage photo swap. Maren asked for this by today.",
      }),
    );
    expect(postBot.mock.calls[0][1].buttons.map((b: { label: string }) => b.label)).toEqual([
      "Start",
      "Done",
      "Tomorrow",
    ]);
  });

  it("says in chat that reminders are not reaching the phone after the second refusal", async () => {
    db = world({
      settings: settingsRow({ push_failures: 1 }),
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    sendPush.mockResolvedValue({ sent: 0, dead: 0 });
    await fire();
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "health",
        refId: "2026-11-14",
        text: "Reminders are not reaching your phone.",
      }),
    );
  });

  // One failed send must not strand the rest of the batch as "sent".
  it("puts a reminder back when its push fails, and still sends the others", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
        { id: "r2", user_id: "u1", task_id: "t1", kind: "at_time" },
      ],
    });
    sendPush.mockRejectedValueOnce(new Error("Push service returned 503"));
    const out = await fire();
    expect(out.sent).toBe(1);
    expect(sendPush).toHaveBeenCalledTimes(2);
    const back = reminderUpdates().find(
      (o) => (o.payload as { status?: string }).status === "scheduled",
    )!;
    expect(back.payload).toEqual({ status: "scheduled", sent_at: null });
    expect(eqValue(back, "id")).toBe("r1");
    expect(back.filters).toContainEqual(["eq", "status", "sent"]);
    expect(db.written("coach_settings")).toEqual([]);
  });

  it("only re-sends a reminder that is still unanswered when the update lands", async () => {
    db = world({
      pending: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          status: "sent",
          sent_at: "2026-11-14T14:00:00Z",
          delivered_at: null,
          resends: 0,
        },
      ],
    });
    await fire();
    expect(reminderUpdates().at(-1)?.filters).toContainEqual([
      "in",
      "status",
      ["sent", "delivered"],
    ]);
  });

  it("cancels a reminder whose task was finished, without sending", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
      task: task({ state: "done" }),
    });
    const out = await fire();
    expect(sendPush).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    expect(reminderUpdates().at(-1)?.payload).toEqual({ status: "cancelled" });
  });

  it("cancels a reminder whose task no longer exists", async () => {
    db = world({
      due: [{ id: "r1", user_id: "u1", task_id: "gone", kind: "morning_of" }],
      task: null,
    });
    await fire();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("re-sends an unanswered reminder after two hours without calling it a failure", async () => {
    db = world({
      pending: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T15:00:00+00:00",
          status: "sent",
          sent_at: "2026-11-14T14:59:00Z",
          delivered_at: null,
          resends: 0,
        },
      ],
    });
    const out = await fire();
    expect(out.resent).toBe(1);
    expect(reminderUpdates().at(-1)?.payload).toEqual({
      status: "sent",
      sent_at: NOW,
      delivered_at: null,
      resends: 1,
    });
    // Unanswered is not the same as not reaching the phone.
    expect(db.written("coach_settings")).toEqual([]);
  });

  // The failure signal is the push service refusing: no device, or a dead token.
  it("counts a failure when the push service accepts the message for no device", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    sendPush.mockResolvedValue({ sent: 0, dead: 1 });
    await fire();
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      user_id: "u1",
      push_failures: 1,
    });
  });

  it("clears the failure count when a push is accepted again", async () => {
    db = world({
      settings: settingsRow({ push_failures: 3 }),
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    await fire();
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      user_id: "u1",
      push_failures: 0,
    });
  });

  it("leaves the count alone when nothing has been failing", async () => {
    db = world({
      due: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-14T17:00:00+00:00",
        },
      ],
    });
    await fire();
    expect(db.written("coach_settings")).toEqual([]);
  });

  it("re-sends a delivered reminder nobody opened after two hours, without counting a failure", async () => {
    db = world({
      pending: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          status: "delivered",
          sent_at: "2026-11-14T14:59:00Z",
          delivered_at: "2026-11-14T14:59:05Z",
          resends: 1,
        },
      ],
    });
    await fire();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(reminderUpdates().at(-1)?.payload).toMatchObject({ resends: 2 });
    expect(db.written("coach_settings")).toEqual([]);
  });

  it("gives up after three re-sends", async () => {
    db = world({
      pending: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "morning_of",
          status: "sent",
          sent_at: "2026-11-14T14:00:00Z",
          delivered_at: null,
          resends: 3,
        },
      ],
    });
    const out = await fire();
    expect(out.expired).toBe(1);
    expect(sendPush).not.toHaveBeenCalled();
    expect(reminderUpdates().at(-1)?.payload).toEqual({ status: "expired" });
  });

  it("holds a re-send during the user's quiet hours", async () => {
    vi.setSystemTime(new Date("2026-11-15T06:30:00Z")); // 22:30 on the 14th in LA
    db = world({
      pending: [
        {
          id: "r1",
          user_id: "u1",
          task_id: "t1",
          kind: "at_time",
          status: "sent",
          sent_at: "2026-11-15T03:00:00Z",
          delivered_at: null,
          resends: 0,
        },
      ],
    });
    const out = await fire();
    expect(out.resent).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
    expect(reminderUpdates()).toHaveLength(1); // only the claim
  });

  it("does nothing when nothing is due or pending", async () => {
    db = world();
    expect(await fire()).toEqual({ sent: 0, resent: 0, expired: 0 });
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("coach weeklyReview", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW)); // Saturday 09:00 in LA; review_dow 6, review_time 09:00
    postBot.mockReset();
    sendPush.mockReset();
    sendPush.mockResolvedValue({ sent: 1, dead: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("tells the user how many undated things are waiting, at their chosen day and hour", async () => {
    db = world({ users: [{ id: "u1" }], undated: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect((await review()).sent).toBe(1);
    expect(sendPush).toHaveBeenCalledWith("u1", {
      title: "Back burner",
      body: "3 things on the back burner.",
      data: { type: "weekly_review" },
    });
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      user_id: "u1",
      last_review_at: NOW,
    });
  });

  it("puts the weekly review in the chat thread, once for that week", async () => {
    db = world({ users: [{ id: "u1" }], undated: [{ id: "a" }, { id: "b" }] });
    await review();
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "review",
        refId: "2026-11-14",
        text: "2 things on the back burner.",
      }),
    );
  });

  it("says 1 thing, not 1 things", async () => {
    db = world({ users: [{ id: "u1" }], undated: [{ id: "a" }] });
    await review();
    expect(sendPush.mock.calls[0][1].body).toBe("1 thing on the back burner.");
  });

  it("stays silent when the back burner is empty", async () => {
    db = world({ users: [{ id: "u1" }], undated: [] });
    expect((await review()).sent).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("stays silent on the wrong day or hour", async () => {
    db = world({
      users: [{ id: "u1" }],
      undated: [{ id: "a" }],
      settings: settingsRow({ review_dow: 0 }),
    });
    await review();
    db = world({
      users: [{ id: "u1" }],
      undated: [{ id: "a" }],
      settings: settingsRow({ review_time: "18:00:00" }),
    });
    await review();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("does not send twice in the same week", async () => {
    db = world({
      users: [{ id: "u1" }],
      undated: [{ id: "a" }],
      settings: settingsRow({ last_review_at: "2026-11-14T16:30:00Z" }),
    });
    await review();
    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("coach reminder reconcile", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
    syncReminders.mockReset();
    syncReminders.mockResolvedValue(true);
  });

  const reconcile = () =>
    (reconcileReminders as unknown as (a: unknown) => Promise<{ repaired: number }>)({ step });

  it("plans reminders for a dated open task that has none", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "coach_tasks") {
        return {
          data: [
            { id: "t1", user_id: "u1" },
            { id: "t2", user_id: "u1" },
            { id: "t3", user_id: "u2" },
          ],
        };
      }
      // t2 already has a reminder; t1 and t3 do not.
      if (op.table === "coach_reminders") return { data: [{ task_id: "t2" }] };
      return undefined;
    });
    expect((await reconcile()).repaired).toBe(2);
    expect(syncReminders).toHaveBeenCalledWith("u1", ["t1"]);
    expect(syncReminders).toHaveBeenCalledWith("u2", ["t3"]);
    const q = db.ops.find((o) => o.table === "coach_tasks")!;
    expect(q.filters).toContainEqual(["in", "state", ["open", "waiting"]]);
    expect(q.filters.some(([m, c]) => m === "gte" && c === "due_date")).toBe(true);
  });

  it("does nothing when every dated task has a reminder", async () => {
    db = makeDb((op: Op) =>
      op.table === "coach_tasks"
        ? { data: [{ id: "t1", user_id: "u1" }] }
        : { data: [{ task_id: "t1" }] },
    );
    expect((await reconcile()).repaired).toBe(0);
    expect(syncReminders).not.toHaveBeenCalled();
  });
});
