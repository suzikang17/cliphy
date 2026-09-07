import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { tagPath, tagParent, tagLeaf, buildTagTree } from "../tags";

describe("tag hierarchy", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("Tags");
  });

  it("parses path, parent, and leaf", () => {
    expect(tagPath("design:typography:serif")).toEqual(["design", "typography", "serif"]);
    expect(tagParent("design:typography:serif")).toBe("design:typography");
    expect(tagParent("design")).toBeNull();
    expect(tagLeaf("design:typography:serif")).toBe("serif");
    expect(tagLeaf("design")).toBe("design");
  });

  it("trims whitespace and ignores empty segments", () => {
    expect(tagPath(" design : color ")).toEqual(["design", "color"]);
  });

  it("builds a nested tree with counts", () => {
    const tree = buildTagTree(["design:typography", "design:color", "work"]);
    expect(tree.map((n) => n.label)).toEqual(["design", "work"]);
    const design = tree.find((n) => n.path === "design")!;
    expect(design.count).toBe(2); // two tags under design
    expect(design.children.map((c) => c.label)).toEqual(["color", "typography"]);
    expect(tree.find((n) => n.path === "work")!.count).toBe(1);
  });

  it("creates intermediate nodes for deep-only tags", () => {
    const tree = buildTagTree(["a:b:c"]);
    expect(tree[0].path).toBe("a");
    expect(tree[0].children[0].path).toBe("a:b");
    expect(tree[0].children[0].children[0].path).toBe("a:b:c");
  });
});
