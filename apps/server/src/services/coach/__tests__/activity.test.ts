import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
vi.mock("../../../lib/supabase.js", () => ({ supabase: {} }));
const { activityLabels } = await import("../activity.js");

const now = new Date("2026-11-14T18:00:00Z");
const names = new Map([
  ["p1", "Maren"],
  ["p2", "Jo"],
]);

describe("activityLabels", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Activity");
  });

  it("says nothing when the bot is idle", () => {
    expect(activityLabels({ bundles: [], pendingReplyAt: null, names }, now)).toEqual([]);
  });

  it("says whose message is being read while a bundle waits or is processed", () => {
    const bundles = [
      {
        person_id: "p1",
        status: "collecting",
        last_message_at: "2026-11-14T17:58:00Z",
        historical: false,
      },
    ];
    expect(activityLabels({ bundles, pendingReplyAt: null, names }, now)).toEqual([
      "Reading Maren's message",
    ]);
    bundles[0].status = "processing";
    expect(activityLabels({ bundles, pendingReplyAt: null, names }, now)).toEqual([
      "Reading Maren's message",
    ]);
  });

  it("names each person once, however many bundles they have", () => {
    const bundles = [
      {
        person_id: "p1",
        status: "collecting",
        last_message_at: "2026-11-14T17:58:00Z",
        historical: false,
      },
      {
        person_id: "p1",
        status: "processing",
        last_message_at: "2026-11-14T17:50:00Z",
        historical: false,
      },
      {
        person_id: "p2",
        status: "collecting",
        last_message_at: "2026-11-14T17:59:00Z",
        historical: false,
      },
    ];
    expect(activityLabels({ bundles, pendingReplyAt: null, names }, now)).toEqual([
      "Reading Maren's message",
      "Reading Jo's message",
    ]);
  });

  it("does not show a bundle that has been stuck for a long time, or history being imported", () => {
    const bundles = [
      {
        person_id: "p1",
        status: "collecting",
        last_message_at: "2026-11-14T17:00:00Z",
        historical: false,
      },
      {
        person_id: "p2",
        status: "collecting",
        last_message_at: "2026-11-14T17:59:00Z",
        historical: true,
      },
    ];
    expect(activityLabels({ bundles, pendingReplyAt: null, names }, now)).toEqual([]);
  });

  it("says Thinking while a typed message has no reply yet, but not for ever", () => {
    expect(
      activityLabels({ bundles: [], pendingReplyAt: "2026-11-14T17:59:40Z", names }, now),
    ).toEqual(["Thinking"]);
    expect(
      activityLabels({ bundles: [], pendingReplyAt: "2026-11-14T17:50:00Z", names }, now),
    ).toEqual([]);
  });

  it("puts Thinking first, since that is what the user is waiting on", () => {
    const bundles = [
      {
        person_id: "p1",
        status: "collecting",
        last_message_at: "2026-11-14T17:58:00Z",
        historical: false,
      },
    ];
    expect(activityLabels({ bundles, pendingReplyAt: "2026-11-14T17:59:40Z", names }, now)).toEqual(
      ["Thinking", "Reading Maren's message"],
    );
  });

  it("falls back to a plain label for a person it cannot name", () => {
    const bundles = [
      {
        person_id: "gone",
        status: "collecting",
        last_message_at: "2026-11-14T17:58:00Z",
        historical: false,
      },
    ];
    expect(activityLabels({ bundles, pendingReplyAt: null, names }, now)).toEqual([
      "Reading a message",
    ]);
  });
});
