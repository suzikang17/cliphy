import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { inWorkingHours, nextCheckIn, type CheckInDay } from "../checkins.js";
import { fileProgress } from "../filing.js";

const work = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
// 2026-11-16 is a Monday.
const at = (time: string, dow = 1) => ({ date: "2026-11-16", time, dow });
const none: CheckInDay = { kinds: [], lastAt: null, ignored: 0 };

describe("check-in timing", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Check-ins");
  });

  it("knows working hours and working days", () => {
    expect(inWorkingHours(at("09:00"), work)).toBe(true);
    expect(inWorkingHours(at("16:59"), work)).toBe(true);
    expect(inWorkingHours(at("17:00"), work)).toBe(false);
    expect(inWorkingHours(at("08:59"), work)).toBe(false);
    expect(inWorkingHours(at("10:00", 6), work)).toBe(false);
    expect(inWorkingHours(at("10:00"), null)).toBe(false);
  });

  it("asks what she is on at the first check-in of the day", () => {
    expect(nextCheckIn(at("09:05"), work, none)).toBe("start");
    // Opened late: still the first question of the day.
    expect(nextCheckIn(at("11:40"), work, none)).toBe("start");
  });

  it("checks in again only after two hours", () => {
    const day: CheckInDay = { kinds: ["start"], lastAt: "09:05", ignored: 0 };
    expect(nextCheckIn(at("10:30"), work, day)).toBeNull();
    expect(nextCheckIn(at("11:05"), work, day)).toBe("during");
  });

  it("asks for a photo once, in the last half hour", () => {
    const day: CheckInDay = { kinds: ["start", "during"], lastAt: "13:00", ignored: 0 };
    expect(nextCheckIn(at("15:30"), work, day)).toBe("during");
    expect(nextCheckIn(at("16:29"), work, day)).toBeNull();
    expect(nextCheckIn(at("16:30"), work, day)).toBe("end");
    expect(
      nextCheckIn(at("16:45"), work, {
        ...day,
        kinds: ["start", "during", "end"],
        lastAt: "16:30",
      }),
    ).toBeNull();
  });

  it("does not start a mid-day check-in so late that it runs into the end one", () => {
    const day: CheckInDay = { kinds: ["start"], lastAt: "09:05", ignored: 0 };
    expect(nextCheckIn(at("16:10"), work, day)).toBeNull();
  });

  it("stops at four a day", () => {
    const day: CheckInDay = {
      kinds: ["start", "during", "during", "during"],
      lastAt: "13:00",
      ignored: 0,
    };
    expect(nextCheckIn(at("15:30"), work, day)).toBeNull();
  });

  // Review Focus 3: every check-in ignored.
  it("stops for the day after two in a row go unanswered", () => {
    const day: CheckInDay = { kinds: ["start", "during"], lastAt: "11:05", ignored: 2 };
    expect(nextCheckIn(at("13:30"), work, day)).toBeNull();
    expect(nextCheckIn(at("16:40"), work, day)).toBeNull();
    // Tomorrow is a new day.
    expect(nextCheckIn({ date: "2026-11-17", time: "09:05", dow: 2 }, work, none)).toBe("start");
  });

  it("never checks in outside working hours, on a day off, or with no hours set", () => {
    expect(nextCheckIn(at("08:30"), work, none)).toBeNull();
    expect(nextCheckIn(at("17:30"), work, none)).toBeNull();
    expect(nextCheckIn(at("10:00", 0), work, none)).toBeNull();
    expect(nextCheckIn(at("10:00"), null, none)).toBeNull();
  });
});

describe("where a progress photo goes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Filing");
  });
  const now = new Date("2026-11-16T20:00:00Z");
  const projects = ["pr1", "pr2", "pr3"];

  it("is sure when she said what she is working on in the last few hours", () => {
    expect(
      fileProgress({
        focus: { projectId: "pr2", setAt: "2026-11-16T17:30:00Z" },
        activeProjects: projects,
        now,
      }),
    ).toEqual({
      projectId: "pr2",
      tier: "sure",
    });
  });

  it("is only fairly sure when the focus is older than that", () => {
    expect(
      fileProgress({
        focus: { projectId: "pr2", setAt: "2026-11-16T08:00:00Z" },
        activeProjects: projects,
        now,
      }),
    ).toEqual({
      projectId: "pr2",
      tier: "fairly",
    });
  });

  it("is fairly sure when there is only one active project", () => {
    expect(fileProgress({ focus: null, activeProjects: ["pr1"], now })).toEqual({
      projectId: "pr1",
      tier: "fairly",
    });
  });

  // Review Focus 4: no focus, several projects.
  it("asks when there is no focus and more than one project it could be", () => {
    expect(fileProgress({ focus: null, activeProjects: projects, now })).toEqual({
      projectId: null,
      tier: "unsure",
    });
    expect(
      fileProgress({
        focus: { projectId: "pr2", setAt: "2026-11-14T08:00:00Z" },
        activeProjects: projects,
        now,
      }),
    ).toEqual({
      projectId: null,
      tier: "unsure",
    });
  });

  it("ignores a focus on a project that is no longer active", () => {
    expect(
      fileProgress({
        focus: { projectId: "gone", setAt: "2026-11-16T19:00:00Z" },
        activeProjects: projects,
        now,
      }).tier,
    ).toBe("unsure");
  });

  it("asks when there are no projects at all", () => {
    expect(fileProgress({ focus: null, activeProjects: [], now })).toEqual({
      projectId: null,
      tier: "unsure",
    });
  });
});
