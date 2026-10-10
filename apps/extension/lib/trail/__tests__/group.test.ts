import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import type { TrailItem } from "@cliphy/shared";
import { groupTrail, trailRows } from "../group";

const item = (id: string, tags: string[]): TrailItem => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  host: "example.com",
  tags,
  closedAt: "2026-10-10T15:00:00.000Z",
  closeCount: 1,
});

describe("groupTrail", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
  });

  it("groups by first tag in newest-first order, untagged last under Other", () => {
    const items = [
      item("a", []),
      item("b", ["client:brightline", "design"]),
      item("c", ["design"]),
      item("d", ["client:brightline"]),
    ];
    const groups = groupTrail(items);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["client › brightline", ["b", "d"]],
      ["design", ["c"]],
      ["Other", ["a"]],
    ]);
    expect(trailRows(groups).map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("returns nothing for an empty trail", () => {
    expect(groupTrail([])).toEqual([]);
  });
});
