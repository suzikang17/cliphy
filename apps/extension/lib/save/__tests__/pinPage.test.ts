import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { runPinPage, type PinPageDeps } from "../pinPage";

function deps(over: Partial<PinPageDeps> = {}): PinPageDeps {
  return {
    isAuthed: vi.fn().mockResolvedValue(true),
    toast: vi.fn().mockResolvedValue(true),
    meta: vi.fn().mockResolvedValue({ title: "Lotus invoice", note: "waiting" }),
    pin: vi.fn().mockResolvedValue({
      pin: { id: "p1" },
      clip: { id: "c1", tags: ["freelance"] },
      created: true,
    }),
    badge: vi.fn(),
    ...over,
  };
}
const tab = { id: 7, url: "https://dashboard.stripe.com/x", title: "Dashboard – Stripe" };
const states = (d: PinPageDeps) => vi.mocked(d.toast).mock.calls.map((c) => c[1]);

describe("runPinPage (⌘⇧P)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Capture");
    feature("Pin page (⌘⇧P)");
  });

  it("toasts, pins with your name/note, then shows Pinned + tags", async () => {
    const d = deps();
    await runPinPage(tab, d);
    expect(states(d)[0]).toEqual({ phase: "saving", title: "Lotus invoice", label: "Pinning…" });
    expect(d.pin).toHaveBeenCalledWith({ url: tab.url, title: "Lotus invoice", note: "waiting" });
    expect(states(d)[1]).toEqual({
      phase: "saved",
      title: "Lotus invoice",
      tags: ["freelance"],
      suggested: [],
      video: false,
      label: "Pinned",
    });
  });

  it("says Already pinned when the pin existed", async () => {
    const d = deps({
      pin: vi
        .fn()
        .mockResolvedValue({ pin: { id: "p1" }, clip: { id: "c1", tags: [] }, created: false }),
    });
    await runPinPage(tab, d);
    expect(states(d)[1]).toMatchObject({ phase: "saved", label: "Already pinned" });
  });

  it("signed out → error toast, nothing pinned; failure → retry message; non-web → badge only", async () => {
    const out = deps({ isAuthed: vi.fn().mockResolvedValue(false) });
    await runPinPage(tab, out);
    expect(out.pin).not.toHaveBeenCalled();
    expect(states(out)[1]).toMatchObject({ phase: "error" });

    const fail = deps({ pin: vi.fn().mockRejectedValue(new Error("x")) });
    await runPinPage(tab, fail);
    expect(states(fail)[1]).toMatchObject({
      phase: "error",
      message: expect.stringMatching(/⌘⇧P/),
    });

    const d = deps();
    await runPinPage({ id: 1, url: "chrome://newtab/" }, d);
    expect(d.toast).not.toHaveBeenCalled();
    expect(d.badge).toHaveBeenCalledWith(1, "✕", false);
  });
});
