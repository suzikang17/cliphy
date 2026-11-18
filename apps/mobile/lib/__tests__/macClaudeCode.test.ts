import { describe, expect, it } from "vitest";
import { macClaudeCodeCard } from "../macClaudeCode";

// The Claude Code card in the Mac window: what it says and offers for each
// place Claude Code on the Mac can stand.

describe("macClaudeCodeCard", () => {
  it("offers to connect before anything is set up", () => {
    const card = macClaudeCodeCard("off");
    expect(card).toMatchObject({ right: "Connect", ok: false, action: "connect" });
  });

  it("treats an unknown answer as not connected", () => {
    expect(macClaudeCodeCard(null).action).toBe("connect");
  });

  it("shows working and offers to disconnect once connected", () => {
    const card = macClaudeCodeCard("on");
    expect(card).toMatchObject({ right: "Working", ok: true, action: "disconnect" });
    expect(card.note).toMatch(/restart/i);
  });

  it("offers to connect again when Claude Code holds another key", () => {
    expect(macClaudeCodeCard("stale")).toMatchObject({ ok: false, action: "connect" });
  });

  it("offers the command to paste when claude can't be found", () => {
    expect(macClaudeCodeCard("missing")).toMatchObject({
      action: "copy",
      actionLabel: "Copy command",
    });
  });
});
