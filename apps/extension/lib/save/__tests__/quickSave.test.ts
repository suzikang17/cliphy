import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { runQuickSave, type QuickSaveDeps } from "../quickSave";

function deps(over: Partial<QuickSaveDeps> = {}) {
  const d: QuickSaveDeps = {
    isAuthed: vi.fn().mockResolvedValue(true),
    toast: vi.fn().mockResolvedValue(true),
    extract: vi.fn().mockResolvedValue({
      title: "Refined Living",
      description: "",
      text: "We Curate Life mockups",
      scrolledToEnd: false,
    }),
    save: vi.fn().mockResolvedValue({
      tags: ["project:lotus-bech"],
      suggestedTags: ["interiors"],
      duplicate: false,
      video: false,
    }),
    badge: vi.fn(),
    ...over,
  };
  return d;
}
const tab = { id: 7, url: "https://wecuratelife-mockups.vercel.app/c", title: "Refined Living" };
const states = (d: QuickSaveDeps) => vi.mocked(d.toast).mock.calls.map((c) => c[1]);

describe("runQuickSave (⌘⇧S)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Capture");
    feature("Quick save (⌘⇧S)");
  });

  it("shows Saving immediately, sends the page text, then animates in the tags", async () => {
    const d = deps();
    await runQuickSave(tab, d);
    expect(states(d)[0]).toEqual({ phase: "saving", title: "Refined Living" });
    expect(d.save).toHaveBeenCalledWith({
      url: tab.url,
      title: "Refined Living",
      text: "We Curate Life mockups",
    });
    expect(states(d)[1]).toEqual({
      phase: "saved",
      title: "Refined Living",
      tags: ["project:lotus-bech"],
      suggested: ["interiors"],
      video: false,
    });
    expect(d.badge).not.toHaveBeenCalled();
  });

  it("the Saving toast comes before any network call", async () => {
    const order: string[] = [];
    const d = deps({
      toast: vi.fn(async () => (order.push("toast"), true)),
      isAuthed: vi.fn(async () => (order.push("auth"), true)),
      save: vi.fn(async () => {
        order.push("save");
        return { tags: [], suggestedTags: [], duplicate: false, video: false };
      }),
    });
    await runQuickSave(tab, d);
    expect(order.slice(0, 2)).toEqual(["toast", "auth"]);
    expect(order.indexOf("save")).toBeGreaterThan(0);
  });

  it("says Already in Cliphy for a saved page", async () => {
    const d = deps({
      save: vi
        .fn()
        .mockResolvedValue({ tags: ["design"], suggestedTags: [], duplicate: true, video: false }),
    });
    await runQuickSave(tab, d);
    expect(states(d)[1]).toEqual({ phase: "duplicate", title: "Refined Living", tags: ["design"] });
  });

  it("never sends page text from password pages", async () => {
    const d = deps({ extract: vi.fn().mockResolvedValue({ skipped: "sensitive" }) });
    await runQuickSave(tab, d);
    expect(d.save).toHaveBeenCalledWith({ url: tab.url, title: "Refined Living" });
  });

  it("asks you to sign in instead of saving when signed out", async () => {
    const d = deps({ isAuthed: vi.fn().mockResolvedValue(false) });
    await runQuickSave(tab, d);
    expect(d.save).not.toHaveBeenCalled();
    expect(states(d)[1]).toEqual({ phase: "error", message: "Sign in to Cliphy to save pages" });
  });

  it("shows a retry message when the save fails", async () => {
    const d = deps({ save: vi.fn().mockRejectedValue(new Error("Network")) });
    await runQuickSave(tab, d);
    expect(states(d)[1]).toMatchObject({ phase: "error", message: expect.stringMatching(/retry/) });
  });

  it("falls back to the toolbar badge on pages that can't show a toast", async () => {
    const d = deps({ toast: vi.fn().mockResolvedValue(false) });
    await runQuickSave(tab, d);
    expect(d.save).toHaveBeenCalled();
    expect(d.badge).toHaveBeenCalledWith(7, "✓", true);
  });

  it("does nothing but badge on non-web pages", async () => {
    const d = deps();
    await runQuickSave({ id: 7, url: "chrome://newtab/" }, d);
    expect(d.toast).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
    expect(d.badge).toHaveBeenCalledWith(7, "✕", false);
  });
});
