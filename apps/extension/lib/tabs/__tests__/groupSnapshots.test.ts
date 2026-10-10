import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import {
  autosave,
  pruneClosedPage,
  markClosed,
  markResumed,
  closedView,
  MAX_SNAPSHOT_PAGES,
  type Snapshots,
} from "../groupSnapshots";
import type { TabGroup } from "../organize";
import type { OpenTab } from "../types";

const T0 = Date.parse("2026-10-10T10:00:00Z");
let id = 1;
const tab = (url: string, title = url): OpenTab =>
  ({
    id: id++,
    windowId: 1,
    url,
    title,
    active: false,
    lastAccessed: 1,
    discarded: false,
  }) as OpenTab;
const group = (key: string, urls: string[], kind = "tag"): TabGroup =>
  ({
    key,
    kind,
    value: key.split(":").slice(1).join(":"),
    label: key.split(":").slice(1).join(":"),
    tabs: urls.map((u) => tab(u)),
  }) as TabGroup;

describe("group snapshots (autosaved tag groups)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
  });

  it("autosave records every open tag group's pages; site and other groups are skipped", () => {
    const { next, changed } = autosave(
      {},
      [
        group("tag:lotus", ["https://a.com/1", "https://a.com/2"]),
        group("site:x.com", ["https://x.com/"], "site"),
      ],
      T0,
    );
    expect(Object.keys(next)).toEqual(["tag:lotus"]);
    expect(next["tag:lotus"].pages.map((p) => p.url)).toEqual([
      "https://a.com/1",
      "https://a.com/2",
    ]);
    expect(changed).toEqual(["tag:lotus"]);
  });

  it("autosave keeps pages that aren't open right now (a window closed) and adds new ones", () => {
    const first = autosave(
      {},
      [group("tag:lotus", ["https://a.com/1", "https://a.com/2"])],
      T0,
    ).next;
    const { next, changed } = autosave(first, [group("tag:lotus", ["https://a.com/3"])], T0 + 1000);
    expect(next["tag:lotus"].pages.map((p) => p.url)).toEqual([
      "https://a.com/3",
      "https://a.com/1",
      "https://a.com/2",
    ]);
    expect(changed).toEqual(["tag:lotus"]);
  });

  it("autosave reports nothing changed when the pages are the same", () => {
    const first = autosave({}, [group("tag:lotus", ["https://a.com/1"])], T0).next;
    expect(autosave(first, [group("tag:lotus", ["https://www.a.com/1/"])], T0 + 1).changed).toEqual(
      [],
    );
  });

  it("caps a snapshot at MAX_SNAPSHOT_PAGES, newest first", () => {
    const urls = Array.from({ length: MAX_SNAPSHOT_PAGES + 5 }, (_, i) => `https://a.com/${i}`);
    const { next } = autosave({}, [group("tag:big", urls)], T0);
    expect(next["tag:big"].pages).toHaveLength(MAX_SNAPSHOT_PAGES);
  });

  it("a page you close on purpose leaves its group's snapshot; an emptied snapshot is removed", () => {
    const snaps = autosave(
      {},
      [
        group("tag:lotus", ["https://a.com/1", "https://a.com/2"]),
        group("tag:solo", ["https://b.com/"]),
      ],
      T0,
    ).next;
    let r = pruneClosedPage(snaps, "https://www.a.com/1");
    expect(r.next["tag:lotus"].pages.map((p) => p.url)).toEqual(["https://a.com/2"]);
    expect(r.changed).toEqual(["tag:lotus"]);
    r = pruneClosedPage(r.next, "https://b.com/");
    expect(r.next["tag:solo"]).toBeUndefined();
    expect(r.removed).toEqual(["tag:solo"]);
  });

  it("closing tabs of a group closed with ⇧C never prunes it", () => {
    let snaps = autosave({}, [group("tag:lotus", ["https://a.com/1"])], T0).next;
    snaps = markClosed(snaps, "tag:lotus", T0 + 5);
    const r = pruneClosedPage(snaps, "https://a.com/1");
    expect(r.next["tag:lotus"].pages).toHaveLength(1);
    expect(r.changed).toEqual([]);
  });

  it("closedView lists snapshots with none of their pages open, newest first", () => {
    let snaps: Snapshots = autosave(
      {},
      [
        group("tag:lotus", ["https://a.com/1", "https://a.com/2"]),
        group("tag:open", ["https://o.com/"]),
      ],
      T0,
    ).next;
    snaps = markClosed(snaps, "tag:lotus", T0 + 60_000);
    const view = closedView(snaps, ["https://o.com/"]);
    expect(view.map((g) => g.key)).toEqual(["tag:lotus"]);
    expect(view[0]).toMatchObject({
      label: "lotus",
      closedAt: new Date(T0 + 60_000).toISOString(),
    });
    // One of its pages open again → it's an open group, not a closed one.
    expect(closedView(snaps, ["https://a.com/2", "https://o.com/"])).toEqual([]);
  });

  it("markResumed clears the closed mark so pruning applies again", () => {
    let snaps = markClosed(
      autosave({}, [group("tag:lotus", ["https://a.com/1"])], T0).next,
      "tag:lotus",
      T0,
    );
    snaps = markResumed(snaps, "tag:lotus");
    expect(snaps["tag:lotus"].closedAt).toBeUndefined();
  });

  it("a page belongs to one saved group: saving it in B removes it from A's saved copy", () => {
    let snaps = autosave({}, [group("tag:a", ["https://x.com/1", "https://x.com/2"])], T0).next;
    const { next, changed } = autosave(snaps, [group("tag:b", ["https://www.x.com/1/"])], T0 + 1);
    expect(next["tag:a"].pages.map((p) => p.url)).toEqual(["https://x.com/2"]);
    expect(next["tag:b"].pages.map((p) => p.url)).toEqual(["https://www.x.com/1/"]);
    expect(changed.sort()).toEqual(["tag:a", "tag:b"]);
    // …and if that empties A, A's saved copy is gone.
    snaps = autosave({}, [group("tag:a", ["https://x.com/1"])], T0).next;
    const r = autosave(snaps, [group("tag:b", ["https://x.com/1"])], T0 + 1);
    expect(r.next["tag:a"]).toBeUndefined();
    expect(r.removed).toEqual(["tag:a"]);
  });
});
