import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import {
  pagesToResume,
  groupCounts,
  countByFirstTag,
  cacheClosedGroups,
  loadCachedClosedGroups,
  NEW_WINDOW_ABOVE,
} from "../closedGroups";
import type { TabGroup } from "../organize";
import type { PagePin } from "../pins";

const page = (url: string, title = url) => ({ url, title });
const pin = (url: string, title = url): PagePin => ({
  pinId: "p:" + url,
  clipId: "c",
  url,
  key: url.replace(/\/$/, ""),
  title,
});

describe("closed groups helpers", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
    vi.clearAllMocks();
  });

  it("pagesToResume = snapshot ∪ pinned, minus pages already open, deduped by page", () => {
    const out = pagesToResume(
      [page("https://a.com/x"), page("https://www.a.com/x?utm_source=1"), page("https://b.com/")],
      [pin("https://c.com/", "C"), pin("https://b.com/", "B")],
      ["https://A.com/x#top"],
    );
    expect(out).toEqual([page("https://b.com/"), page("https://c.com/", "C")]);
  });

  it("groupCounts reports open / pinned / trail for a tag group", () => {
    const group = {
      key: "tag:design",
      kind: "tag",
      value: "design",
      label: "design",
      tabs: [
        {
          id: 1,
          windowId: 1,
          url: "https://a.com/x",
          title: "A",
          active: false,
          lastAccessed: 1,
          discarded: false,
        },
        {
          id: 2,
          windowId: 1,
          url: "https://b.com/",
          title: "B",
          active: false,
          lastAccessed: 1,
          discarded: false,
        },
      ],
    } as TabGroup;
    expect(groupCounts(group, [pin("https://a.com/x"), pin("https://z.com/")], 14)).toEqual({
      open: 2,
      pinned: 1,
      trail: 14,
    });
  });

  it("countByFirstTag counts trail items by their first tag", () => {
    expect(
      countByFirstTag([
        { tags: ["design", "x"] },
        { tags: ["design"] },
        { tags: [] },
        { tags: ["ai"] },
      ]),
    ).toEqual(
      new Map([
        ["design", 2],
        ["ai", 1],
      ]),
    );
  });

  it("caches closed groups locally (fallback when the server can't be reached)", async () => {
    const store: Record<string, unknown> = {};
    browserMock.storage.local.set.mockImplementation(
      async (o: Record<string, unknown>) => void Object.assign(store, o),
    );
    browserMock.storage.local.get.mockImplementation(async (k: string) => ({ [k]: store[k] }));
    await cacheClosedGroups([
      { key: "tag:x", label: "x", pages: [page("https://a.com/")], closedAt: "t" },
    ]);
    expect(await loadCachedClosedGroups()).toEqual([
      { key: "tag:x", label: "x", pages: [page("https://a.com/")], closedAt: "t" },
    ]);
    expect(NEW_WINDOW_ABOVE).toBe(8);
  });
});
