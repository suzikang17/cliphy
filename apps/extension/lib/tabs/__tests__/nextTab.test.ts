import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { pickNextTab } from "../nextTab";

// A window's tab strip, left to right.
const strip = [10, 11, 12, 13, 14].map((id, index) => ({ id, index }));

describe("pickNextTab", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
  });

  it("moves to the next tab to the right that isn't being closed", () => {
    expect(pickNextTab(strip, 11, new Set([11]))).toBe(12);
    expect(pickNextTab(strip, 11, new Set([11, 12, 13]))).toBe(14);
  });

  it("falls back to the nearest tab on the left at the end of the strip", () => {
    expect(pickNextTab(strip, 14, new Set([14]))).toBe(13);
    expect(pickNextTab(strip, 13, new Set([13, 14, 12]))).toBe(11);
  });

  it("returns null when the active tab isn't being closed or nothing is left", () => {
    expect(pickNextTab(strip, 11, new Set([12]))).toBeNull();
    expect(pickNextTab(strip, 11, new Set(strip.map((t) => t.id)))).toBeNull();
  });

  it("uses strip order, not array order", () => {
    const shuffled = [strip[3], strip[0], strip[4], strip[1], strip[2]];
    expect(pickNextTab(shuffled, 11, new Set([11]))).toBe(12);
  });
});
