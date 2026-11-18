import type { MacClaudeCodeStatus } from "./desktop";

/** The Claude Code card in the Mac window, for each place it can stand. */
export interface MacClaudeCodeCard {
  detail: string;
  /** The word at the row's right edge. */
  right: string;
  ok: boolean;
  /** What the open card says. */
  note: string;
  /** The button the open card offers. */
  action: "connect" | "disconnect" | "copy";
  actionLabel: string;
}

export function macClaudeCodeCard(status: MacClaudeCodeStatus | null): MacClaudeCodeCard {
  switch (status) {
    case "on":
      return {
        detail: "Connected on this Mac",
        right: "Working",
        ok: true,
        note: "If Claude Code was already open, restart it. Then ask it what's open on a project.",
        action: "disconnect",
        actionLabel: "Disconnect",
      };
    case "stale":
      return {
        detail: "Set up with a different key",
        right: "Connect",
        ok: false,
        note: "Claude Code here holds a key other than this Mac's, from the website or an earlier connection. Connect to switch it to this Mac's.",
        action: "connect",
        actionLabel: "Connect",
      };
    case "missing":
      return {
        detail: "Claude Code wasn't found on this Mac",
        right: "Connect",
        ok: false,
        note: "Install Claude Code, then press Check again. If it's installed and this still shows, copy the command and paste it into a terminal.",
        action: "copy",
        actionLabel: "Copy command",
      };
    default:
      return {
        detail: "Let it see what's open and mark work done",
        right: "Connect",
        ok: false,
        note: "Claude Code on this Mac will use this Mac's connection. It can read your projects, tasks and clients' messages, add tasks and mark them done.",
        action: "connect",
        actionLabel: "Connect",
      };
  }
}
