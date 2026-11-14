import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { countIgnored, inWorkingHours, nextCheckIn, type CheckInDay } from "../checkins.js";
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

  // At most four a day and at least two hours apart, the end one included.
  it("never sends more than four in a day, counting the photo ask", () => {
    let day: CheckInDay = { kinds: [], lastAt: null, ignored: 0 };
    const sent: string[] = [];
    for (let minutes = 9 * 60; minutes < 17 * 60; minutes += 15) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      const kind = nextCheckIn(at(time), work, day);
      if (kind) {
        sent.push(`${kind}@${time}`);
        day = { kinds: [...day.kinds, kind], lastAt: time, ignored: 0 };
      }
    }
    expect(sent).toEqual(["start@09:00", "during@11:00", "during@13:00", "end@16:30"]);
  });

  it("does not ask for a photo less than two hours after the last check-in", () => {
    const day: CheckInDay = { kinds: ["start"], lastAt: "15:10", ignored: 0 };
    expect(nextCheckIn(at("16:35"), work, day)).toBeNull();
  });

  it("does not open the day with a photo ask, or check in at all when the hours are very short", () => {
    expect(nextCheckIn(at("16:40"), work, none)).toBeNull();
    const short = { days: [1], start: "09:00", end: "09:30" };
    expect(nextCheckIn(at("09:05"), short, none)).toBeNull();
  });

  it("does not ask for a photo when one was already sent today", () => {
    const day: CheckInDay = { kinds: ["start"], lastAt: "09:05", ignored: 0, photoToday: true };
    expect(nextCheckIn(at("16:35"), work, day)).toBeNull();
  });

  it("does not start a mid-day check-in within two hours of the photo ask", () => {
    const day: CheckInDay = { kinds: ["start"], lastAt: "09:05", ignored: 0 };
    expect(nextCheckIn(at("14:30"), work, day)).toBe("during");
    expect(nextCheckIn(at("14:45"), work, day)).toBeNull();
  });

  it("stops at four a day", () => {
    const day: CheckInDay = {
      kinds: ["start", "during", "during", "during"],
      lastAt: "13:00",
      ignored: 0,
    };
    expect(nextCheckIn(at("15:30"), work, day)).toBeNull();
    expect(nextCheckIn(at("16:35"), work, day)).toBeNull();
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

describe("which check-ins went unanswered", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Check-ins");
  });
  const c = (createdAt: string, chosen: number | null = null) => ({ createdAt, chosen });

  it("counts the latest check-ins in a row with no tap and no typed reply", () => {
    expect(countIgnored([c("09:00"), c("11:00")], [], "13:00")).toBe(2);
    expect(countIgnored([c("09:00", 0), c("11:00")], [], "13:00")).toBe(1);
    expect(countIgnored([], [], "13:00")).toBe(0);
  });

  it("counts a typed reply after a check-in as an answer to it", () => {
    expect(countIgnored([c("09:00"), c("11:00")], ["11:20"], "13:00")).toBe(0);
  });

  // A reply typed to the morning check-in still counts after a later one is ignored.
  it("does not forget an earlier typed answer when a later check-in is ignored", () => {
    expect(countIgnored([c("09:00"), c("11:00")], ["09:10"], "13:00")).toBe(1);
  });

  it("does not credit a reply to a check-in that came after it", () => {
    expect(countIgnored([c("09:00"), c("11:00")], ["08:30"], "13:00")).toBe(2);
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
