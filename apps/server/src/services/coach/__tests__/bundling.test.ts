import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { pickBundle } from "../bundling.js";

const open = { id: "b1", status: "collecting" as const, lastMessageAt: "2026-11-14T09:42:00Z" };

describe("pickBundle", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Bundling");
  });

  it("appends a message sent within the quiet window", () => {
    expect(pickBundle(open, "in", "2026-11-14T09:43:30Z")).toBe("append");
  });
  it("appends a message exactly at the edge of the window", () => {
    expect(pickBundle(open, "in", "2026-11-14T09:45:00Z")).toBe("append");
  });
  it("starts a new bundle after the quiet window", () => {
    expect(pickBundle(open, "in", "2026-11-14T09:45:01Z")).toBe("new");
  });
  it("appends an out-of-order message that is earlier but inside the window", () => {
    expect(pickBundle(open, "in", "2026-11-14T09:41:10Z")).toBe("append");
  });
  it("starts a new bundle when the open one is already processing", () => {
    expect(pickBundle({ ...open, status: "processing" }, "in", "2026-11-14T09:42:30Z")).toBe("new");
  });
  it("starts a new bundle when the last one failed", () => {
    expect(pickBundle({ ...open, status: "failed" }, "in", "2026-11-14T09:42:30Z")).toBe("new");
  });
  it("never bundles an outgoing message", () => {
    expect(pickBundle(open, "out", "2026-11-14T09:42:30Z")).toBe("none");
  });
  it("starts a new bundle when there is none", () => {
    expect(pickBundle(null, "in", "2026-11-14T09:42:30Z")).toBe("new");
  });
  it("honours a custom quiet window", () => {
    expect(pickBundle(open, "in", "2026-11-14T09:42:30Z", 10_000)).toBe("new");
  });
});
