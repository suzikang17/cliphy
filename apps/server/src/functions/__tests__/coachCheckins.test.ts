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

const { checkIns, CHECKIN_JOB } = await import("../coachCheckins.js");

const step = { run: async (_n: string, fn: () => Promise<unknown>) => fn() };
const run = () => (checkIns as unknown as (a: unknown) => Promise<{ sent: number }>)({ step });

const settings = (over: Record<string, unknown> = {}) => ({
  user_id: "u1",
  timezone: "America/Los_Angeles",
  quiet_start: "21:00:00",
  quiet_end: "08:00:00",
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00:00",
  work_end: "17:00:00",
  focus_project_id: null,
  focus_set_at: null,
  ...over,
});

interface World {
  settings?: Record<string, unknown> | null;
  /** Today's check-in messages, oldest first. */
  checkins?: Record<string, unknown>[];
  /** Whether the user wrote anything after the last check-in. */
  userMessages?: string[];
  /** Whether a progress photo was already sent today. */
  photoToday?: boolean;
  users?: { id: string }[];
  settingsFor?: Record<string, Record<string, unknown> | null>;
}
function world(w: World = {}) {
  return makeDb((op: Op) => {
    if (op.table === "users") return { data: w.users ?? [{ id: "u1" }] };
    if (op.table === "coach_settings") {
      const userId = eqValue(op, "user_id") as string;
      if (w.settingsFor && userId in w.settingsFor) return { data: w.settingsFor[userId] };
      return { data: w.settings === undefined ? settings() : w.settings };
    }
    if (op.table === "coach_progress") return { data: w.photoToday ? [{ id: "e1" }] : [] };
    if (op.table === "coach_projects") {
      return {
        data: [
          { id: "pr1", name: "Alder House" },
          { id: "pr2", name: "Portfolio" },
        ],
      };
    }
    if (op.table === "coach_chat_messages") {
      const isUserLookup = op.filters.some(
        ([m, c, v]) => m === "eq" && c === "role" && v === "user",
      );
      if (isUserLookup) {
        return { data: (w.userMessages ?? []).map((created_at) => ({ created_at })) };
      }
      return { data: w.checkins ?? [] };
    }
    return { data: [] };
  });
}

describe("coach check-ins job", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Check-ins");
    vi.useFakeTimers();
    // Monday 16 Nov 2026, 09:05 in Los Angeles.
    vi.setSystemTime(new Date("2026-11-16T17:05:00Z"));
    sendPush.mockReset();
    postBot.mockReset();
    sendPush.mockResolvedValue({ sent: 1, dead: 0 });
    postBot.mockResolvedValue("m-new");
    db = world();
  });
  afterEach(() => vi.useRealTimers());

  it("asks what she is on at the start of a working day, in chat and as a notification", async () => {
    expect((await run()).sent).toBe(1);
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        kind: "checkin",
        refId: "2026-11-16:start",
        text: "What are you on today?",
      }),
    );
    expect(sendPush).toHaveBeenCalledWith("u1", {
      title: "Cliphy",
      body: "What are you on today?",
      data: { type: "checkin" },
    });
  });

  // Review Focus 2: two runs in the same window.
  it("does not notify when the check-in was already in the thread", async () => {
    postBot.mockResolvedValue(null);
    expect((await run()).sent).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
  });

  // Review Focus 1: no timezone, or no hours.
  it("never checks in for someone with no timezone or no working hours", async () => {
    db = world({ settings: settings({ timezone: null }) });
    await run();
    db = world({ settings: settings({ work_days: null, work_start: null, work_end: null }) });
    await run();
    db = world({ settings: null });
    await run();
    expect(postBot).not.toHaveBeenCalled();
  });

  it("stays quiet outside working hours and on a day off", async () => {
    vi.setSystemTime(new Date("2026-11-16T15:30:00Z")); // 07:30 Monday
    await run();
    vi.setSystemTime(new Date("2026-11-15T18:00:00Z")); // Sunday 10:00
    await run();
    expect(postBot).not.toHaveBeenCalled();
  });

  it("asks if she is still on the same thing two hours later, by name", async () => {
    vi.setSystemTime(new Date("2026-11-16T19:10:00Z")); // 11:10
    db = world({
      settings: settings({ focus_project_id: "pr1", focus_set_at: "2026-11-16T17:06:00Z" }),
      checkins: [{ ref_id: "2026-11-16:start", chosen: 0, created_at: "2026-11-16T17:05:00Z" }],
    });
    await run();
    expect(postBot.mock.calls[0][1]).toMatchObject({
      text: "Still on Alder House?",
      refId: "2026-11-16:during:1",
    });
  });

  // Review Focus 3: every check-in ignored.
  it("stops for the day after two check-ins in a row go unanswered", async () => {
    vi.setSystemTime(new Date("2026-11-16T21:30:00Z")); // 13:30
    db = world({
      checkins: [
        { ref_id: "2026-11-16:start", chosen: null, created_at: "2026-11-16T17:05:00Z" },
        { ref_id: "2026-11-16:during:1", chosen: null, created_at: "2026-11-16T19:10:00Z" },
      ],
    });
    expect((await run()).sent).toBe(0);
    expect(postBot).not.toHaveBeenCalled();
  });

  it("counts a typed reply as an answer, even with no button tapped", async () => {
    vi.setSystemTime(new Date("2026-11-16T21:30:00Z")); // 13:30
    db = world({
      checkins: [
        { ref_id: "2026-11-16:start", chosen: null, created_at: "2026-11-16T17:05:00Z" },
        { ref_id: "2026-11-16:during:1", chosen: null, created_at: "2026-11-16T19:10:00Z" },
      ],
      userMessages: ["2026-11-16T19:25:00Z"],
    });
    expect((await run()).sent).toBe(1);
  });

  // A reply typed to the morning check-in must still count after a later one is ignored.
  it("keeps going after one real miss when the morning check-in was answered by typing", async () => {
    vi.setSystemTime(new Date("2026-11-16T21:30:00Z")); // 13:30
    db = world({
      checkins: [
        { ref_id: "2026-11-16:start", chosen: null, created_at: "2026-11-16T17:05:00Z" },
        { ref_id: "2026-11-16:during:1", chosen: null, created_at: "2026-11-16T19:10:00Z" },
      ],
      userMessages: ["2026-11-16T17:12:00Z"],
    });
    expect((await run()).sent).toBe(1);
  });

  it("does not interrupt when she wrote to the bot in the last ten minutes", async () => {
    db = world({ userMessages: ["2026-11-16T17:00:00Z"] }); // five minutes ago
    expect((await run()).sent).toBe(0);
    expect(postBot).not.toHaveBeenCalled();
  });

  it("does not ask for a photo when she already sent one today", async () => {
    vi.setSystemTime(new Date("2026-11-17T00:35:00Z")); // 16:35 Monday
    db = world({
      checkins: [{ ref_id: "2026-11-16:start", chosen: 0, created_at: "2026-11-16T17:05:00Z" }],
      photoToday: true,
    });
    expect((await run()).sent).toBe(0);
  });

  it("carries on with everyone else when one person's settings are broken", async () => {
    db = world({
      users: [{ id: "broken" }, { id: "u1" }],
      settingsFor: { broken: settings({ user_id: "broken", timezone: "Not/AZone" }) },
    });
    expect((await run()).sent).toBe(1);
    expect(postBot).toHaveBeenCalledWith("u1", expect.objectContaining({ kind: "checkin" }));
  });

  it("asks for a photo in the last half hour", async () => {
    vi.setSystemTime(new Date("2026-11-17T00:35:00Z")); // 16:35 Monday
    db = world({
      checkins: [{ ref_id: "2026-11-16:start", chosen: 0, created_at: "2026-11-16T17:05:00Z" }],
    });
    await run();
    expect(postBot.mock.calls[0][1]).toMatchObject({
      text: "Photo of where you got to?",
      refId: "2026-11-16:end",
    });
  });

  it("runs every 15 minutes", () => {
    expect(CHECKIN_JOB).toMatchObject({ triggers: [{ cron: "*/15 * * * *" }] });
  });
});
