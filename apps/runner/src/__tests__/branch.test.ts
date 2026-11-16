import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { branchName } from "../branch.js";
import { RUN_ID } from "./fixtures.js";

describe("the branch a run works on", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
  });

  it("is cliphy/, the start of the run id and the first four words of the title", () => {
    expect(branchName(RUN_ID, "Move the sconces up on page 2!")).toBe(
      "cliphy/3f9a1c2e-move-the-sconces-up",
    );
  });

  it("keeps only letters, digits and dashes", () => {
    expect(branchName(RUN_ID, "Fix  “About” — it's wrong; rm -rf ~")).toBe(
      "cliphy/3f9a1c2e-fix-about-it-s",
    );
    expect(branchName("../../etc", "x")).toBe("cliphy/etc-x");
  });

  it("still has a name when the title has nothing usable", () => {
    expect(branchName(RUN_ID, "!!! ???")).toBe("cliphy/3f9a1c2e-change");
  });
});
