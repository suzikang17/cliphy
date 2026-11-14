import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CoachChatMessage, CoachHealth, CoachReminder, Person } from "@cliphy/shared";
import {
  mergeMessages,
  newestTime,
  isCoachOff,
  smsUrl,
  mirrorPlan,
  mirrorId,
  mirrorIdsFor,
  toStored,
  fromStored,
  setupSteps,
  agoLabel,
  helperRunning,
  formatPairCode,
  pairCodeComplete,
  dayParts,
  reopenOutcome,
  MIRROR_DELAY_MS,
} from "../coach";

const msg = (over: Partial<CoachChatMessage>): CoachChatMessage => ({
  id: "m",
  role: "bot",
  text: "",
  attachments: [],
  buttons: [],
  link: null,
  chosen: null,
  kind: "did",
  createdAt: "2026-11-14T17:00:00Z",
  ...over,
});
const reminder = (over: Partial<CoachReminder>): CoachReminder => ({
  id: "r1",
  taskId: "t1",
  kind: "morning_of",
  fireAt: "2026-11-18T17:00:00Z",
  status: "scheduled",
  title: "Homepage photo swap",
  body: "Maren asked for this by today.",
  ...over,
});

describe("coach phone logic", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Phone");
  });

  it("merges polled messages by id, keeping the thread in time order", () => {
    const have = [
      msg({ id: "a", createdAt: "2026-11-14T17:00:00Z" }),
      msg({ id: "c", createdAt: "2026-11-14T17:02:00Z" }),
    ];
    const got = [
      msg({ id: "b", createdAt: "2026-11-14T17:01:00Z" }),
      msg({ id: "c", createdAt: "2026-11-14T17:02:00Z", text: "updated" }),
    ];
    const merged = mergeMessages(have, got);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(merged[2].text).toBe("updated");
  });

  // Review Focus 2: a stale poll must not undo a tap.
  it("never lets a poll clear a button the user has already tapped", () => {
    const have = [msg({ id: "a", chosen: 1 })];
    const stale = [msg({ id: "a", chosen: null })];
    expect(mergeMessages(have, stale)[0].chosen).toBe(1);
  });

  it("replaces an optimistic message with the server's copy", () => {
    const have = [
      msg({
        id: "local-1",
        role: "user",
        text: "only the words",
        createdAt: "2026-11-14T17:05:00Z",
      }),
    ];
    const got = [
      msg({ id: "srv-9", role: "user", text: "only the words", createdAt: "2026-11-14T17:05:01Z" }),
    ];
    expect(mergeMessages(have, got).map((m) => m.id)).toEqual(["srv-9"]);
  });

  it("keeps an optimistic message the server has not returned yet", () => {
    const have = [msg({ id: "local-1", role: "user", text: "hello" })];
    expect(mergeMessages(have, []).map((m) => m.id)).toEqual(["local-1"]);
  });

  it("finds the newest server time to poll from, ignoring unsent local messages", () => {
    expect(newestTime([])).toBeUndefined();
    expect(
      newestTime([
        msg({ id: "a", createdAt: "2026-11-14T17:00:00Z" }),
        msg({ id: "local-1", createdAt: "2026-11-14T18:00:00Z" }),
      ]),
    ).toBe("2026-11-14T17:00:00Z");
  });

  // Review Focus 1: an account without the switch.
  it("recognises the server saying the coach is not enabled", () => {
    expect(isCoachOff(new Error("coach_not_enabled"))).toBe(true);
    expect(isCoachOff(new Error("API error 500"))).toBe(false);
    expect(isCoachOff("coach_not_enabled")).toBe(false);
  });

  it("builds a Messages link with the draft for each platform", () => {
    expect(smsUrl("+1 555 0100", "It's live — take a look?", "ios")).toBe(
      "sms:+15550100&body=It's%20live%20%E2%80%94%20take%20a%20look%3F",
    );
    expect(smsUrl("+15550100", "Hi", "android")).toBe("sms:+15550100?body=Hi");
  });

  // Review Focus 4: no number for the person.
  it("has no Messages link when the person has no phone number", () => {
    expect(smsUrl(null, "Hi", "ios")).toBeNull();
    expect(smsUrl("maren@example.com", "Hi", "ios")).toBeNull();
  });

  // Review Focus 3: push and local copy.
  it("schedules a late local copy of each upcoming reminder and cancels copies no longer wanted", () => {
    const now = new Date("2026-11-14T18:00:00Z");
    const r1 = reminder({ id: "r1" });
    const plan = mirrorPlan(
      [r1, reminder({ id: "r2", fireAt: "2026-11-14T17:00:00Z" })],
      ["coach-r9-1", mirrorId(r1), "other-app-thing"],
      now,
    );
    expect(plan.schedule).toEqual([]);
    expect(plan.cancel).toEqual(["coach-r9-1"]);

    const fresh = mirrorPlan([r1], [], now);
    expect(fresh.schedule).toEqual([
      {
        identifier: mirrorId(r1),
        reminderId: "r1",
        taskId: "t1",
        title: "Homepage photo swap",
        body: "Maren asked for this by today.",
        date: new Date(Date.parse("2026-11-18T17:00:00Z") + MIRROR_DELAY_MS),
      },
    ]);
  });

  it("moves the local copy when a reminder's time changes", () => {
    const now = new Date("2026-11-14T18:00:00Z");
    const before = reminder({ id: "r1", fireAt: "2026-11-18T17:00:00Z" });
    const after = reminder({ id: "r1", fireAt: "2026-11-19T17:00:00Z" });
    const plan = mirrorPlan([after], [mirrorId(before)], now);
    expect(plan.cancel).toEqual([mirrorId(before)]);
    expect(plan.schedule.map((s) => s.identifier)).toEqual([mirrorId(after)]);
  });

  it("finds every local copy of a reminder, whatever time it was scheduled for", () => {
    const a = mirrorId(reminder({ id: "r1", fireAt: "2026-11-18T17:00:00Z" }));
    const b = mirrorId(reminder({ id: "r1", fireAt: "2026-11-19T17:00:00Z" }));
    const other = mirrorId(reminder({ id: "r10" }));
    expect(mirrorIdsFor("r1", [a, other, b, "unrelated"])).toEqual([a, b]);
  });

  it("waits long enough before the local copy that an opened push has cancelled it", () => {
    expect(MIRROR_DELAY_MS).toBe(15 * 60_000);
  });

  // Review Focus 5: a cold start with no network.
  it("saves the thread and whether the coach is on, without unsent messages", () => {
    const stored = toStored({
      status: "on",
      messages: [msg({ id: "a" }), msg({ id: "local-1", role: "user" })],
    });
    expect(JSON.parse(stored)).toEqual({ status: "on", messages: [msg({ id: "a" })] });
  });

  it("keeps only the newest 50 messages", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      msg({ id: `m${i}`, createdAt: `2026-11-14T17:${String(i).padStart(2, "0")}:00Z` }),
    );
    const kept = JSON.parse(toStored({ status: "on", messages: many })).messages;
    expect(kept).toHaveLength(50);
    expect(kept[0].id).toBe("m10");
  });

  it("restores what was saved, and nothing from anything it cannot read", () => {
    const stored = toStored({ status: "on", messages: [msg({ id: "a" })] });
    expect(fromStored(stored)).toEqual({ status: "on", messages: [msg({ id: "a" })] });
    expect(fromStored(null)).toBeNull();
    expect(fromStored("not json")).toBeNull();
    expect(fromStored(JSON.stringify({ status: "banana", messages: [] }))).toBeNull();
    expect(fromStored(JSON.stringify({ status: "on", messages: "nope" }))).toBeNull();
  });

  it("does not restore 'unknown', which is not worth remembering", () => {
    expect(fromStored(JSON.stringify({ status: "unknown", messages: [] }))).toBeNull();
  });

  it("lists the setup steps still to do, in order", () => {
    const health: CoachHealth = {
      pushTokens: 0,
      timezoneSet: true,
      pushOk: false,
      lastDeliveredAt: null,
      helperSeenAt: null,
    };
    expect(setupSteps(health, [], false)).toEqual(["reminders", "person", "messages", "try"]);
    const person = { id: "p", captureThread: false } as Person;
    expect(
      setupSteps({ ...health, pushTokens: 1, pushOk: true, lastDeliveredAt: "x" }, [person], false),
    ).toEqual(["messages", "try"]);
    expect(
      setupSteps(
        { ...health, pushTokens: 1, pushOk: true, lastDeliveredAt: "x" },
        [{ ...person, captureThread: true }],
        true,
      ),
    ).toEqual([]);
  });

  it("treats reminders as not proven until one has actually been delivered", () => {
    const health: CoachHealth = {
      pushTokens: 1,
      timezoneSet: true,
      pushOk: true,
      lastDeliveredAt: null,
      helperSeenAt: null,
    };
    expect(setupSteps(health, [], false)[0]).toBe("reminders");
  });

  it("says how long ago something was seen, in a couple of words", () => {
    const now = new Date("2026-11-14T18:00:00Z");
    expect(agoLabel("2026-11-14T17:59:40Z", now)).toBe("just now");
    expect(agoLabel("2026-11-14T17:58:00Z", now)).toBe("2 min ago");
    expect(agoLabel("2026-11-14T15:00:00Z", now)).toBe("3 h ago");
    expect(agoLabel("2026-11-11T18:00:00Z", now)).toBe("3 days ago");
    expect(agoLabel("2026-11-13T17:00:00Z", now)).toBe("1 day ago");
    expect(agoLabel(null, now)).toBeNull();
  });

  it("treats the Mac as running only if it checked in within the last 90 seconds", () => {
    const now = new Date("2026-11-14T18:00:00Z");
    // The helper checks in every 20 seconds; a few misses are a blip, minutes are not.
    expect(helperRunning("2026-11-14T17:59:00Z", now)).toBe(true);
    expect(helperRunning("2026-11-14T17:57:00Z", now)).toBe(false);
    expect(helperRunning("2026-11-14T17:40:00Z", now)).toBe(false);
    expect(helperRunning(null, now)).toBe(false);
  });

  it("splits a date into the number and short day for a list row", () => {
    expect(dayParts("2026-11-14")).toEqual({ num: "14", dow: "Sat" });
    expect(dayParts("2026-12-01")).toEqual({ num: "1", dow: "Tue" });
  });
});

describe("formatPairCode", () => {
  it("upper-cases and groups the code as it is typed", () => {
    expect(formatPairCode("abcd")).toBe("ABCD");
    expect(formatPairCode("abcde")).toBe("ABCD-E");
    expect(formatPairCode("abcdefgh")).toBe("ABCD-EFGH");
  });
  it("ignores spaces, dashes and anything past eight characters", () => {
    expect(formatPairCode(" ab-cd ef gh ij ")).toBe("ABCD-EFGH");
  });
  it("knows when the code is complete", () => {
    expect(pairCodeComplete("ABCD-EFG")).toBe(false);
    expect(pairCodeComplete("ABCD-EFGH")).toBe(true);
  });
});

describe("reopening a history request", () => {
  const history = { historical: true, status: "closed" as const };

  it("waits while the request is still filed as history", () => {
    expect(reopenOutcome(history, 3_000)).toBe("waiting");
    expect(reopenOutcome(null, 3_000)).toBe("waiting");
  });

  it("knows when it has come back as a new request", () => {
    expect(reopenOutcome({ historical: false, status: "new" }, 6_000)).toBe("reopened");
  });

  it("stops watching after a minute without claiming to know the outcome", () => {
    expect(reopenOutcome(history, 59_000)).toBe("waiting");
    expect(reopenOutcome(history, 60_000)).toBe("still-reading");
  });
});
