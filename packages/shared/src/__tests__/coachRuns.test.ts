import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { isRunnable, REPO_PATTERN } from "../coach";

const task = { kind: "do", state: "open", blocked: false } as const;
const project = { repo: "example/alder-house" };

describe("which tasks can be started on the site", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
  });

  it("an open, unblocked piece of work in a project with a repo can be", () => {
    expect(isRunnable(task, project)).toBe(true);
  });

  it("nothing else can be", () => {
    expect(isRunnable({ ...task, kind: "tell" }, project)).toBe(false);
    expect(isRunnable({ ...task, state: "done" }, project)).toBe(false);
    expect(isRunnable({ ...task, blocked: true }, project)).toBe(false);
    expect(isRunnable(task, null)).toBe(false);
    expect(isRunnable(task, { repo: null })).toBe(false);
  });

  it("a repo is owner/name and nothing more", () => {
    expect(REPO_PATTERN.test("example/alder-house")).toBe(true);
    for (const bad of [
      "alder-house",
      "https://github.com/example/alder-house",
      "a/b/c",
      "a/b;rm -rf",
    ]) {
      expect(REPO_PATTERN.test(bad)).toBe(false);
    }
  });
});
