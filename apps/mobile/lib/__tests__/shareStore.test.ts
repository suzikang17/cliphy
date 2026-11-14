import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { couldBeRequest } from "../shareStore";

describe("couldBeRequest", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Phone");
  });

  it("treats a bare link as a clip to save, as it always was", () => {
    expect(couldBeRequest({ text: "https://youtu.be/abc123", imageUris: [] })).toBe(false);
    expect(couldBeRequest({ text: "  https://example.com/page  ", imageUris: [] })).toBe(false);
  });

  it("treats images as something a person might have sent", () => {
    expect(couldBeRequest({ text: "", imageUris: ["file:///a.png"] })).toBe(true);
    expect(couldBeRequest({ text: "https://example.com", imageUris: ["file:///a.png"] })).toBe(
      true,
    );
  });

  it("treats words that are more than a link as a possible request", () => {
    expect(
      couldBeRequest({
        text: "can you swap the homepage photo? https://example.com",
        imageUris: [],
      }),
    ).toBe(true);
    expect(
      couldBeRequest({ text: "I like the writing on page 1 more than page 2", imageUris: [] }),
    ).toBe(true);
  });

  it("ignores an empty share", () => {
    expect(couldBeRequest({ text: "   ", imageUris: [] })).toBe(false);
  });
});
