import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";
import { getTabMeta, setTabMeta, loadAllTabMeta, metaFor, META_PREFIX } from "../tabMeta";

// In-memory storage.local so set → get round-trips.
let store: Record<string, unknown> = {};

describe("tab names and notes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — names & notes");
    store = {};
    browserMock.storage.local.get.mockImplementation(async (k: string | null) =>
      k === null ? { ...store } : { [k]: store[k] },
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(store, o);
    });
    browserMock.storage.local.remove.mockImplementation(async (k: string) => {
      delete store[k];
    });
  });

  it("stores per page, so the same page reopened (any tab, tracking params) keeps it", async () => {
    await setTabMeta("https://dashboard.stripe.com/invoices?utm_source=x#top", {
      title: "  Lotus   invoice #3 ",
      note: "waiting on client",
    });
    expect(await getTabMeta("https://www.dashboard.stripe.com/invoices")).toEqual({
      title: "Lotus invoice #3",
      note: "waiting on client",
    });
  });

  it("merges changes and removes the entry when both are cleared", async () => {
    const url = "https://a.com/x";
    await setTabMeta(url, { title: "Name" });
    await setTabMeta(url, { note: "Note" });
    expect(await getTabMeta(url)).toEqual({ title: "Name", note: "Note" });
    await setTabMeta(url, { title: "", note: "  " });
    expect(Object.keys(store).filter((k) => k.startsWith(META_PREFIX))).toEqual([]);
  });

  it("caps lengths", async () => {
    const m = await setTabMeta("https://a.com", { title: "t".repeat(300), note: "n".repeat(900) });
    expect(m.title).toHaveLength(200);
    expect(m.note).toHaveLength(500);
  });

  it("loads all entries and looks pages up by URL", async () => {
    await setTabMeta("https://a.com/x", { note: "A" });
    await setTabMeta("https://b.com", { title: "B" });
    store["unrelated"] = 1;
    const all = await loadAllTabMeta();
    expect(Object.keys(all)).toHaveLength(2);
    expect(metaFor(all, "https://www.a.com/x#h")).toEqual({ note: "A" });
    expect(metaFor(all, "https://nope.com")).toEqual({});
  });

  it("never throws if storage fails", async () => {
    browserMock.storage.local.get.mockRejectedValue(new Error("boom"));
    expect(await getTabMeta("https://a.com")).toEqual({});
    expect(await loadAllTabMeta()).toEqual({});
    vi.restoreAllMocks();
  });
});
