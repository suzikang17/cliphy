import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { toDays, fromDays } from "../retention";

describe("trail retention units", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
  });

  it("converts amount + unit to days, clamped to 1–3650; forever is null", () => {
    expect(toDays({ amount: 3, unit: "weeks" })).toBe(21);
    expect(toDays({ amount: 6, unit: "months" })).toBe(180);
    expect(toDays({ amount: 10, unit: "days" })).toBe(10);
    expect(toDays({ amount: 1, unit: "forever" })).toBeNull();
    expect(toDays({ amount: 0, unit: "days" })).toBe(1);
    expect(toDays({ amount: 99999, unit: "days" })).toBe(3650);
    expect(toDays({ amount: 2.6, unit: "weeks" })).toBe(21);
  });

  it("picks the largest unit that divides evenly when reading days back", () => {
    expect(fromDays(null)).toEqual({ amount: 1, unit: "forever" });
    expect(fromDays(21)).toEqual({ amount: 3, unit: "weeks" });
    expect(fromDays(180)).toEqual({ amount: 6, unit: "months" });
    expect(fromDays(10)).toEqual({ amount: 10, unit: "days" });
    expect(fromDays(30)).toEqual({ amount: 1, unit: "months" });
  });
});
