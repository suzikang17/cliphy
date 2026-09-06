import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { moveTile } from "../tileOrder";

describe("moveTile", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Tiles");
  });

  it("moves an item later in the list", () => {
    expect(moveTile(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier in the list", () => {
    expect(moveTile(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when the indices match", () => {
    expect(moveTile(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores out-of-range indices", () => {
    expect(moveTile(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveTile(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    moveTile(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
