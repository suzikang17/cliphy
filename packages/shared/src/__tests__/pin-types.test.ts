import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { PinnedItem, ViewQuery, PanelItem, Summary } from "../index";

describe("pin types", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Types");
  });

  it("models a clip pin with no view query", () => {
    const pin: PinnedItem = {
      id: "p1",
      userId: "u1",
      kind: "clip",
      layout: "tile",
      position: 0,
      label: "Linear",
      clipId: "c1",
      pinnedAt: "t",
      updatedAt: "t",
    };
    expect(pin.kind).toBe("clip");
    expect(pin.viewQuery).toBeUndefined();
  });

  it("models a view pin carrying a semantic query", () => {
    const viewQuery: ViewQuery = { semantic: "design inspiration", limit: 12 };
    const pin: PinnedItem = {
      id: "p2",
      userId: "u1",
      kind: "view",
      layout: "panel",
      position: 1,
      label: "Design",
      viewQuery,
      pinnedAt: "t",
      updatedAt: "t",
    };
    expect(pin.viewQuery?.semantic).toBe("design inspiration");
    expect(pin.clipId).toBeUndefined();
  });

  it("normalizes a panel item", () => {
    const item: PanelItem = { id: "c1", title: "T", url: "https://x.test" };
    expect(item.title).toBe("T");
  });

  it("allows enrichment tier and archive state on a summary", () => {
    const clip: Summary = {
      id: "c1",
      userId: "u1",
      sourceType: "web",
      status: "completed",
      tags: [],
      createdAt: "t",
      updatedAt: "t",
      enrichmentTier: "metadata",
      archivedAt: undefined,
    } as Summary;
    expect(clip.enrichmentTier).toBe("metadata");
  });
});
