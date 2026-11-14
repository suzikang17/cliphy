import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CoachSettings } from "@cliphy/shared";
import { planReminders, nextResend, REMINDER_DEFAULTS } from "../reminderPlan.js";
import { reminderText } from "../reminderText.js";

const settings: CoachSettings = {
  timezone: "America/Los_Angeles",
  quietStart: "21:00",
  quietEnd: "08:00",
  reviewDow: 0,
  reviewTime: "18:00",
};
// Saturday 14 Nov 2026, 10:00 in Los Angeles.
const now = new Date("2026-11-14T18:00:00Z");
const plan = (dueDate: string | null, dueTime: string | null = null, at = now) =>
  planReminders({ dueDate, dueTime }, settings, at).map((r) => [r.kind, r.fireAt.toISOString()]);

describe("planReminders", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
  });

  it("plans nothing for an undated task", () => {
    expect(plan(null)).toEqual([]);
  });

  it("reminds the day before and the morning of, at 09:00 local", () => {
    expect(plan("2026-11-18")).toEqual([
      ["day_before", "2026-11-17T17:00:00.000Z"],
      ["morning_of", "2026-11-18T17:00:00.000Z"],
    ]);
  });

  it("adds a reminder at the due time", () => {
    expect(plan("2026-11-18", "14:00")).toEqual([
      ["day_before", "2026-11-17T17:00:00.000Z"],
      ["morning_of", "2026-11-18T17:00:00.000Z"],
      ["at_time", "2026-11-18T22:00:00.000Z"],
    ]);
  });

  // Review Focus 5: a due time inside quiet hours.
  it("moves a 07:00 reminder to 20:45 the evening before, never dropping it", () => {
    const planned = plan("2026-11-18", "07:00");
    expect(planned).toContainEqual(["at_time", "2026-11-18T04:45:00.000Z"]); // 20:45 on the 17th
    expect(planned.map(([k]) => k)).toEqual(["day_before", "at_time", "morning_of"]);
  });

  it("moves a 22:30 reminder to 20:45 the same evening", () => {
    expect(plan("2026-11-18", "22:30")).toContainEqual(["at_time", "2026-11-19T04:45:00.000Z"]);
  });

  it("collapses a due time that is within 30 minutes of the morning reminder", () => {
    expect(plan("2026-11-18", "09:15")).toEqual([
      ["day_before", "2026-11-17T17:00:00.000Z"],
      ["morning_of", "2026-11-18T17:00:00.000Z"],
    ]);
  });

  it("drops reminders already in the past", () => {
    // Due tomorrow, planned at 10:00 today: the day-before 09:00 has passed.
    expect(plan("2026-11-15")).toEqual([["morning_of", "2026-11-15T17:00:00.000Z"]]);
  });

  it("fires now for a task due today whose reminders have all passed", () => {
    expect(plan("2026-11-14")).toEqual([["morning_of", now.toISOString()]]);
  });

  it("does not fire again for a task due today that has already been reminded", () => {
    expect(
      planReminders({ dueDate: "2026-11-14", dueTime: null }, settings, now, { hasFired: true }),
    ).toEqual([]);
  });

  // A 07:00 deadline confirmed at 20:50 the night before: the 20:45 slot has
  // passed, and the 09:00 morning reminder would come after the deadline.
  it("fires now when every reminder before the deadline has already passed", () => {
    const evening = new Date("2026-11-15T04:50:00Z"); // 20:50 on the 14th in LA
    const planned = planReminders({ dueDate: "2026-11-15", dueTime: "07:00" }, settings, evening);
    expect(planned.map((r) => [r.kind, r.fireAt.toISOString()])).toEqual([
      ["at_time", evening.toISOString()],
      ["morning_of", "2026-11-15T17:00:00.000Z"],
    ]);
  });

  it("cannot fire now for a passed slot once quiet hours have started", () => {
    const night = new Date("2026-11-15T05:30:00Z"); // 21:30 on the 14th in LA
    const planned = planReminders({ dueDate: "2026-11-15", dueTime: "07:00" }, settings, night);
    expect(planned.map((r) => r.kind)).toEqual(["morning_of"]);
  });

  it("plans nothing for a task whose date has already gone", () => {
    expect(plan("2026-11-10")).toEqual([]);
  });

  it("does not fire now during quiet hours; it waits for them to end", () => {
    const night = new Date("2026-11-15T06:00:00Z"); // 22:00 on the 14th in LA
    expect(plan("2026-11-15", null, night)).toEqual([["morning_of", "2026-11-15T17:00:00.000Z"]]);
    const lateNight = new Date("2026-11-14T07:30:00Z"); // 23:30 on the 13th; due "today" = the 13th
    expect(plan("2026-11-13", null, lateNight)).toEqual([]);
  });
});

describe("nextResend", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
  });
  const sentAt = "2026-11-14T17:00:00Z";
  const after = (ms: number) => new Date(Date.parse(sentAt) + ms);

  it("re-sends a reminder the phone never reported receiving after 10 minutes", () => {
    const r = { status: "sent" as const, sentAt, deliveredAt: null, resends: 0 };
    expect(nextResend(r, after(9 * 60_000))).toBeNull();
    expect(nextResend(r, after(10 * 60_000))).toBe("resend");
  });

  it("re-sends a delivered reminder nobody opened after 2 hours", () => {
    const r = { status: "delivered" as const, sentAt, deliveredAt: sentAt, resends: 0 };
    expect(nextResend(r, after(119 * 60_000))).toBeNull();
    expect(nextResend(r, after(120 * 60_000))).toBe("resend");
  });

  it("gives up after the maximum number of re-sends", () => {
    const r = {
      status: "sent" as const,
      sentAt,
      deliveredAt: null,
      resends: REMINDER_DEFAULTS.maxResends,
    };
    expect(nextResend(r, after(60 * 60_000))).toBe("expire");
  });

  it("leaves acknowledged, cancelled and scheduled reminders alone", () => {
    for (const status of ["acked", "cancelled", "scheduled", "expired"] as const) {
      expect(
        nextResend({ status, sentAt, deliveredAt: null, resends: 0 }, after(10 * 3_600_000)),
      ).toBeNull();
    }
  });
});

describe("reminderText", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Reminders");
  });
  const base = { title: "Homepage photo swap", taskKind: "do" as const, dueTime: null };

  it("says who asked and by when for a client's request", () => {
    expect(
      reminderText({ ...base, kind: "morning_of", personName: "Maren", fromRequest: true }),
    ).toEqual({
      title: "Homepage photo swap",
      body: "Maren asked for this by today.",
    });
    expect(
      reminderText({ ...base, kind: "day_before", personName: "Maren", fromRequest: true }).body,
    ).toBe("Maren asked for this by tomorrow.");
    expect(
      reminderText({
        ...base,
        kind: "at_time",
        personName: "Maren",
        fromRequest: true,
        dueTime: "14:00",
      }).body,
    ).toBe("Maren asked for this by 14:00.");
  });

  it("is plain for the user's own task", () => {
    const own = { ...base, title: "Frame the print", personName: null, fromRequest: false };
    expect(reminderText({ ...own, kind: "day_before" }).body).toBe("Due tomorrow.");
    expect(reminderText({ ...own, kind: "morning_of" }).body).toBe("Due today.");
    expect(reminderText({ ...own, kind: "at_time", dueTime: "09:00" }).body).toBe("Due at 09:00.");
  });

  it("does not claim someone asked when the task is the user's own, even with a person on it", () => {
    expect(
      reminderText({ ...base, kind: "morning_of", personName: "Maren", fromRequest: false }).body,
    ).toBe("Due today.");
  });
});
