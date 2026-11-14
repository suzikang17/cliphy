import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CoachRequest } from "@cliphy/shared";
import { buildHistory } from "../history.js";

const req = (over: Partial<CoachRequest>): CoachRequest => ({
  id: "r",
  bundleId: "b",
  projectId: "pr1",
  personId: "p1",
  understood: "x",
  openQuestion: null,
  answer: null,
  status: "confirmed",
  replacesId: null,
  proposedReplacesId: null,
  proposedTasks: [],
  dueDate: null,
  historical: false,
  createdAt: "2026-01-01T00:00:00Z",
  confirmedAt: null,
  ...over,
});

describe("buildHistory", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Project history");
  });

  it("nests a replaced request under the one that replaced it, newest first", () => {
    const entries = buildHistory([
      req({ id: "r1", status: "replaced", createdAt: "2022-03-01T00:00:00Z" }),
      req({ id: "r2", replacesId: "r1", createdAt: "2026-11-14T00:00:00Z" }),
      req({ id: "r3", status: "closed", createdAt: "2026-10-28T00:00:00Z" }),
    ]);
    expect(entries.map((e) => e.request.id)).toEqual(["r2", "r3"]);
    expect(entries[0].replaced.map((r) => r.id)).toEqual(["r1"]);
    expect(entries[1].replaced).toEqual([]);
  });

  it("follows a chain of replacements under the newest", () => {
    const entries = buildHistory([
      req({ id: "a", status: "replaced", createdAt: "2024-01-01T00:00:00Z" }),
      req({ id: "b", status: "replaced", replacesId: "a", createdAt: "2025-01-01T00:00:00Z" }),
      req({ id: "c", replacesId: "b", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].replaced.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("still shows a replaced request whose replacement is not in the list", () => {
    const entries = buildHistory([req({ id: "orphan", status: "replaced" })]);
    expect(entries.map((e) => e.request.id)).toEqual(["orphan"]);
  });

  it("does not loop on requests that point at each other", () => {
    const entries = buildHistory([
      req({ id: "x", replacesId: "y", createdAt: "2026-02-01T00:00:00Z" }),
      req({ id: "y", replacesId: "x", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    const ids = entries.flatMap((e) => [e.request.id, ...e.replaced.map((r) => r.id)]);
    expect(ids.sort()).toEqual(["x", "y"]);
  });

  it("returns nothing for no requests", () => {
    expect(buildHistory([])).toEqual([]);
  });
});
