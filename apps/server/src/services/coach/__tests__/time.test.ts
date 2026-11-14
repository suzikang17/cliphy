import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import {
  zonedToUtc,
  localParts,
  addDays,
  inQuietHours,
  isValidTimezone,
  shiftMinutes,
} from "../time.js";

describe("coach time helpers", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Time");
  });

  it("turns a wall-clock time in a timezone into the right instant", () => {
    expect(zonedToUtc("2026-11-18", "09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-11-18T17:00:00.000Z",
    );
    expect(zonedToUtc("2026-11-18", "09:00", "UTC").toISOString()).toBe("2026-11-18T09:00:00.000Z");
    expect(zonedToUtc("2026-11-18", "09:00", "Asia/Seoul").toISOString()).toBe(
      "2026-11-18T00:00:00.000Z",
    );
  });

  // Review Focus 2: 09:00 local stays 09:00 local across a daylight-saving change.
  it("keeps the wall-clock time across a daylight-saving change", () => {
    expect(zonedToUtc("2026-03-07", "09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-03-07T17:00:00.000Z",
    );
    expect(zonedToUtc("2026-03-09", "09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-03-09T16:00:00.000Z",
    );
  });

  it("reads an instant back as local date, time and weekday", () => {
    const at = new Date("2026-11-15T03:00:00Z");
    expect(localParts(at, "America/Los_Angeles")).toEqual({
      date: "2026-11-14",
      time: "19:00",
      dow: 6,
    });
    expect(localParts(at, "UTC")).toEqual({ date: "2026-11-15", time: "03:00", dow: 0 });
  });

  it("reads midnight as 00:00, not 24:00", () => {
    expect(localParts(new Date("2026-11-15T00:00:00Z"), "UTC").time).toBe("00:00");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("shifts a wall-clock time by minutes, reporting a day change", () => {
    expect(shiftMinutes("21:00", -15)).toEqual({ time: "20:45", dayOffset: 0 });
    expect(shiftMinutes("00:10", -15)).toEqual({ time: "23:55", dayOffset: -1 });
  });

  it("knows quiet hours that cross midnight", () => {
    expect(inQuietHours("07:00", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("23:30", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("21:00", "21:00", "08:00")).toBe(true);
    expect(inQuietHours("08:00", "21:00", "08:00")).toBe(false);
    expect(inQuietHours("20:59", "21:00", "08:00")).toBe(false);
  });

  it("knows quiet hours within one day, and none when start equals end", () => {
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("15:00", "12:00", "14:00")).toBe(false);
    expect(inQuietHours("13:00", "09:00", "09:00")).toBe(false);
  });

  it("accepts Postgres times with seconds", () => {
    expect(inQuietHours("07:00", "21:00:00", "08:00:00")).toBe(true);
  });

  it("recognises a real timezone", () => {
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
