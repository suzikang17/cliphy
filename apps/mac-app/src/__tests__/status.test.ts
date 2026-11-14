import { describe, expect, it } from "vitest";
import type { AppState } from "../controller.js";
import { statusLine } from "../status.js";

const now = new Date("2026-11-14T18:00:00Z");
const state = (over: Partial<AppState>): AppState => ({
  step: "ready",
  code: null,
  account: null,
  error: null,
  offline: false,
  people: [],
  lastSyncAt: null,
  lastUploaded: 0,
  ...over,
});

describe("menu-bar status line", () => {
  it("names the step still to do during setup", () => {
    expect(statusLine(state({ step: "pair" }), now)).toBe("Not connected");
    expect(statusLine(state({ step: "access" }), now)).toBe("Needs access to Messages");
  });
  it("says when it last checked", () => {
    expect(statusLine(state({ lastSyncAt: "2026-11-14T17:59:50Z" }), now)).toBe(
      "Connected · checked just now",
    );
    expect(statusLine(state({ lastSyncAt: "2026-11-14T17:48:00Z" }), now)).toBe(
      "Connected · checked 12 min ago",
    );
    expect(statusLine(state({ lastSyncAt: "2026-11-14T15:00:00Z" }), now)).toBe(
      "Connected · checked 3 h ago",
    );
  });
  it("puts problems first", () => {
    expect(statusLine(state({ offline: true, lastSyncAt: "2026-11-14T17:59:50Z" }), now)).toBe(
      "No connection",
    );
    expect(statusLine(state({ error: "The coach is not turned on for this account." }), now)).toBe(
      "The coach is not turned on for this account.",
    );
  });
  it("is plain before the first check", () => {
    expect(statusLine(state({}), now)).toBe("Connected");
  });
});
