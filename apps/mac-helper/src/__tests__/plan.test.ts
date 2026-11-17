import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { placePictures } from "../plan.js";

// Messages marks where each picture sits inside a text with U+FFFC. The mark
// is not something anyone wrote, so it leaves the words; where it stood is kept.

const P = "￼";

describe("placePictures", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Coach");
    await feature("Mac helper");
  });

  it("takes the marks out and says where each stood in the words that remain", () => {
    expect(placePictures(`Use one of these:${P}${P} and under Details:${P} Thanks`)).toEqual({
      text: "Use one of these: and under Details: Thanks",
      at: [17, 17, 36],
    });
  });

  it("counts from the start of the trimmed text", () => {
    expect(placePictures(`  ${P}look at this`)).toEqual({ text: "look at this", at: [0] });
    expect(placePictures(`look at this ${P}  `)).toEqual({ text: "look at this", at: [12] });
  });

  it("handles a message that is only pictures, and one with none", () => {
    expect(placePictures(`${P}${P}`)).toEqual({ text: "", at: [0, 0] });
    expect(placePictures("just words")).toEqual({ text: "just words", at: [] });
  });
});
