import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({ signImageUrl: vi.fn() }));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
const syncMock = vi.fn();
vi.mock("../../../services/coach/reminders.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/reminders.js")>()),
  syncTaskReminders: (...a: unknown[]) => syncMock(...a),
}));
const sendPushMock = vi.fn();
vi.mock("../../../services/push.js", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown = {}) => app().request(path, json("POST", body));
const patch = (path: string, body: unknown) => app().request(path, json("PATCH", body));

interface World {
  reminders?: Record<string, unknown>[];
  updated?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  tokens?: unknown[];
  openDated?: { id: string }[];
}
function world(w: World = {}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_reminders" && op.action === "select")
      return { data: w.reminders ?? [] };
    if (op.table === "coach_reminders" && op.action === "update") {
      return { data: w.updated === undefined ? { id: "r1" } : w.updated };
    }
    if (op.table === "coach_tasks") {
      return eqValue(op, "user_id") && op.filters.some(([m, c]) => m === "not" && c === "due_date")
        ? { data: w.openDated ?? [] }
        : {
            data: [
              {
                id: "t1",
                title: "Homepage photo swap",
                kind: "do",
                due_time: null,
                with_person_id: "p1",
                request_id: "q1",
              },
            ],
          };
    }
    if (op.table === "coach_people") return { data: [{ id: "p1", name: "Maren" }] };
    if (op.table === "coach_settings" && op.action === "select")
      return { data: w.settings ?? null };
    if (op.table === "coach_settings") return { data: null };
    if (op.table === "push_tokens") return { data: w.tokens ?? [] };
    return undefined;
  });
}

describe("coach reminders routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
    syncMock.mockReset();
    db = world();
  });

  it("lists upcoming reminders with their words, for the phone to mirror", async () => {
    db = world({
      reminders: [
        {
          id: "r1",
          task_id: "t1",
          kind: "morning_of",
          fire_at: "2026-11-18T17:00:00+00:00",
          status: "scheduled",
        },
      ],
    });
    const res = await app().request("/api/coach/reminders");
    expect((await res.json()).reminders).toEqual([
      {
        id: "r1",
        taskId: "t1",
        kind: "morning_of",
        fireAt: "2026-11-18T17:00:00+00:00",
        status: "scheduled",
        title: "Homepage photo swap",
        body: "Maren asked for this by today.",
      },
    ]);
    const q = db.ops[0];
    expect(q.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
    expect(q.filters).toContainEqual(["eq", "status", "scheduled"]);
  });

  it("marks a sent reminder delivered and clears the failure count", async () => {
    const res = await post("/api/coach/reminders/r1/delivered");
    expect(res.status).toBe(200);
    const op = db.ops.find((o) => o.table === "coach_reminders" && o.action === "update")!;
    expect(op.payload).toMatchObject({ status: "delivered", delivered_at: expect.any(String) });
    expect(op.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
    expect(op.filters).toContainEqual(["eq", "status", "sent"]);
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      user_id: "test-user-id",
      push_failures: 0,
      last_delivered_at: expect.any(String),
    });
  });

  it("still records that the phone is reachable when the reminder was already answered", async () => {
    db = world({ updated: null });
    const res = await post("/api/coach/reminders/r1/delivered");
    expect(res.status).toBe(200);
    expect(db.written("coach_settings", "upsert")).toHaveLength(1);
  });

  it("acknowledges a reminder that was scheduled, sent or delivered", async () => {
    const res = await post("/api/coach/reminders/r1/ack");
    expect(res.status).toBe(200);
    const op = db.ops.find((o) => o.table === "coach_reminders" && o.action === "update")!;
    expect(op.payload).toMatchObject({ status: "acked", acked_at: expect.any(String) });
    expect(op.filters).toContainEqual(["in", "status", ["scheduled", "sent", "delivered"]]);
    expect(op.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
  });

  it("returns default settings when none are stored", async () => {
    const res = await app().request("/api/coach/settings");
    expect((await res.json()).settings).toEqual({
      timezoneSet: false,
      timezone: "UTC",
      quietStart: "21:00",
      quietEnd: "08:00",
      reviewDow: 0,
      reviewTime: "18:00",
    });
  });

  it("saves a timezone and re-plans reminders for every open dated task", async () => {
    db = world({ openDated: [{ id: "t1" }, { id: "t2" }] });
    const res = await patch("/api/coach/settings", { timezone: "America/Los_Angeles" });
    expect(res.status).toBe(200);
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      user_id: "test-user-id",
      timezone: "America/Los_Angeles",
    });
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["t1", "t2"]);
  });

  it("does not re-plan reminders for a change that cannot move them", async () => {
    await patch("/api/coach/settings", { reviewDow: 3, reviewTime: "17:00" });
    expect(db.written("coach_settings", "upsert")[0]).toMatchObject({
      review_dow: 3,
      review_time: "17:00",
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("rejects a timezone that does not exist, a malformed time and a day outside the week", async () => {
    for (const body of [
      { timezone: "Mars/Olympus_Mons" },
      { quietStart: "9pm" },
      { quietEnd: "25:00" },
      { reviewDow: 7 },
    ]) {
      expect((await patch("/api/coach/settings", body)).status).toBe(400);
    }
    expect(db.writtenTables()).toEqual([]);
  });

  it("reports notifications as working with a token and no failures", async () => {
    db = world({
      tokens: [{ token: "a" }],
      settings: { push_failures: 0, last_delivered_at: "2026-11-14T17:00:05Z" },
    });
    expect(await (await app().request("/api/coach/health")).json()).toEqual({
      pushTokens: 1,
      timezoneSet: false,
      pushOk: true,
      lastDeliveredAt: "2026-11-14T17:00:05Z",
    });
  });

  it("says whether the timezone has been set, since nothing is planned until it is", async () => {
    db = world({
      tokens: [{ token: "a" }],
      settings: { push_failures: 0, timezone: "America/Los_Angeles" },
    });
    expect((await (await app().request("/api/coach/health")).json()).timezoneSet).toBe(true);
  });

  it("sends a test notification on request, so setup can prove reminders arrive", async () => {
    sendPushMock.mockResolvedValue({ sent: 1, dead: 0 });
    const res = await post("/api/coach/health/test-push");
    expect(await res.json()).toEqual({ sent: 1 });
    expect(sendPushMock).toHaveBeenCalledWith("test-user-id", {
      title: "Cliphy",
      body: "Reminders work.",
      data: { type: "test" },
    });
  });

  // Review Focus 3: the token is dead, or reminders are not being received.
  it("reports notifications as not getting through with no token or two missed reminders", async () => {
    db = world({ tokens: [] });
    expect((await (await app().request("/api/coach/health")).json()).pushOk).toBe(false);
    db = world({ tokens: [{ token: "a" }], settings: { push_failures: 2 } });
    expect((await (await app().request("/api/coach/health")).json()).pushOk).toBe(false);
  });
});
