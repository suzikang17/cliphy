import { beforeEach, describe, it, expect } from "vitest";
import { epic, feature } from "allure-js-commons";
import { runChecks } from "../checks.js";
import type { SummaryJson } from "@cliphy/shared";

describe("runChecks", () => {
  beforeEach(() => {
    epic("Eval");
    feature("Quality Checks");
  });

  const good: SummaryJson = {
    summary: "Word ".repeat(300).trim(),
    keyPoints: ["a", "b", "c", "d", "e"],
    timestamps: ["0:00 - Intro", "2:30 - Main"],
  };

  it("passes a good summary", () => {
    const results = runChecks(good, { retried: false });
    expect(results.every((r) => r.pass)).toBe(true);
  });

  it("fails when keyPoints count is too low", () => {
    const bad = { ...good, keyPoints: ["a", "b"] };
    const results = runChecks(bad, { retried: false });
    const kp = results.find((r) => r.name === "keyPoints");
    expect(kp?.pass).toBe(false);
  });

  it("fails when summary is too short", () => {
    const bad = { ...good, summary: "Too short." };
    const results = runChecks(bad, { retried: false });
    const sw = results.find((r) => r.name === "summaryWords");
    expect(sw?.pass).toBe(false);
  });

  it("fails when timestamps are missing", () => {
    const bad = { ...good, timestamps: [] };
    const results = runChecks(bad, { retried: false });
    const ts = results.find((r) => r.name === "timestamps");
    expect(ts?.pass).toBe(false);
  });

  it("fails when parse required retry", () => {
    const results = runChecks(good, { retried: true });
    const p = results.find((r) => r.name === "parseFirstTry");
    expect(p?.pass).toBe(false);
  });
});
