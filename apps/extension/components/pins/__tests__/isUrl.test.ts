import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { looksLikeUrl, toUrl } from "../isUrl";

describe("looksLikeUrl", () => {
  beforeEach(() => {
    layer("unit");
    epic("Notes");
    feature("Capture routing");
  });

  it("treats full urls as links", () => {
    expect(looksLikeUrl("https://linear.app")).toBe(true);
    expect(looksLikeUrl("http://example.test/a/b?c=d")).toBe(true);
  });

  it("treats bare hosts as links", () => {
    expect(looksLikeUrl("linear.app")).toBe(true);
    expect(looksLikeUrl("linear.app/inbox")).toBe(true);
  });

  it("treats prose as a note", () => {
    expect(looksLikeUrl("call mum")).toBe(false);
    expect(looksLikeUrl("shipped the pins tab today")).toBe(false);
    expect(looksLikeUrl("idea: group tiles by tag")).toBe(false);
  });

  it("treats a single word with no dot as a note", () => {
    expect(looksLikeUrl("standup")).toBe(false);
  });

  it("treats a sentence containing a domain as a note, not a link", () => {
    // A space means prose — otherwise "check linear.app later" becomes a bookmark.
    expect(looksLikeUrl("check linear.app later")).toBe(false);
  });

  it("ignores empty input", () => {
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("   ")).toBe(false);
  });

  it("normalises bare hosts to https", () => {
    expect(toUrl("linear.app")).toBe("https://linear.app");
    expect(toUrl("https://linear.app")).toBe("https://linear.app");
  });
});
