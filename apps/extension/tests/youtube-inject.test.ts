import { describe, it, expect } from "vitest";
import { parseDurationToSeconds } from "../lib/duration";

describe("parseDurationToSeconds", () => {
  it("converts MM:SS format", () => {
    expect(parseDurationToSeconds("4:32")).toBe(272);
  });

  it("converts HH:MM:SS format", () => {
    expect(parseDurationToSeconds("1:23:45")).toBe(5025);
  });

  it("handles single-digit minutes", () => {
    expect(parseDurationToSeconds("0:45")).toBe(45);
  });

  it("handles hour-long videos", () => {
    expect(parseDurationToSeconds("1:00:00")).toBe(3600);
  });

  it("returns 0 for empty string", () => {
    expect(parseDurationToSeconds("")).toBe(0);
  });

  it("returns 0 for unrecognized format", () => {
    expect(parseDurationToSeconds("LIVE")).toBe(0);
  });
});
