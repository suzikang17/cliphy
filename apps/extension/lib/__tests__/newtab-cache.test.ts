import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";
import { readSnapshot, writeSnapshot } from "../newtab-cache";

const store: Record<string, unknown> = {};

describe("newtab cache", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Snapshot");
    for (const k of Object.keys(store)) delete store[k];
    browserMock.storage.local.get.mockImplementation(async (key: string) => ({
      [key]: store[key],
    }));
    browserMock.storage.local.set.mockImplementation(async (obj: Record<string, unknown>) => {
      Object.assign(store, obj);
    });
  });

  it("returns null when nothing is cached", async () => {
    expect(await readSnapshot()).toBeNull();
  });

  it("round-trips a snapshot", async () => {
    await writeSnapshot({ pins: [], panels: { inbox: [] }, savedAt: 123 });
    const snap = await readSnapshot();
    expect(snap?.savedAt).toBe(123);
    expect(snap?.pins).toEqual([]);
    expect(snap?.panels.inbox).toEqual([]);
  });

  it("survives a corrupt cached value", async () => {
    store["newtab:snapshot"] = "not-an-object";
    expect(await readSnapshot()).toBeNull();
  });

  it("survives storage throwing outright", async () => {
    browserMock.storage.local.get.mockRejectedValueOnce(new Error("no storage"));
    expect(await readSnapshot()).toBeNull();
  });

  it("never throws when a write fails", async () => {
    browserMock.storage.local.set.mockRejectedValueOnce(new Error("quota"));
    await expect(writeSnapshot({ pins: [], panels: {}, savedAt: 1 })).resolves.toBeUndefined();
  });
});
