import { Platform } from "react-native";

/**
 * True in the web build: a wide window with a keyboard. The screens get a
 * side nav in place of the tab bar, and the phone-only parts (push, reminders,
 * the share sheet) are switched off.
 */
export const DESKTOP = Platform.OS === "web";

/**
 * True in the copy of the web build that the Mac app loads (built with
 * EXPO_PUBLIC_TARGET=mac). It needs no sign-in: the Mac app answers every
 * /api/ call itself and adds the Mac's own key. The other copy is served on
 * cliphy.app and uses the sign-in of the website it sits beside.
 */
export const MAC_WINDOW = DESKTOP && process.env.EXPO_PUBLIC_TARGET === "mac";

/** Where Claude Code on the Mac stands. missing: no `claude` there. stale: an old key. */
export type MacClaudeCodeStatus = "missing" | "off" | "on" | "stale";

/** Each Claude Code action answers with where it stands, or the system's message. */
export interface MacClaudeCodeAnswer {
  status: MacClaudeCodeStatus | null;
  error: string | null;
}

/** Claude Code on the Mac, set up by the Mac app with its own key. The key never reaches the page. */
export interface MacClaudeCode {
  status(): Promise<MacClaudeCodeAnswer>;
  connect(): Promise<MacClaudeCodeAnswer>;
  disconnect(): Promise<MacClaudeCodeAnswer>;
  /** Put the connect command on the clipboard, for a `claude` the Mac app cannot find. */
  copyCommand(): Promise<boolean>;
}

/** What the Mac app lets the page ask of it. Absent in a plain browser. */
interface MacBridge {
  openSetup?: () => void;
  claudeCode?: MacClaudeCode;
}

/** Claude Code on this Mac, when the page is in the Mac window. */
export function macClaudeCode(): MacClaudeCode | null {
  return (globalThis as { helper?: MacBridge }).helper?.claudeCode ?? null;
}

/** Open the Mac's own screen: who is captured from Messages, and the connection. */
export function openMacSetup(): boolean {
  const bridge = (globalThis as { helper?: MacBridge }).helper;
  if (!bridge?.openSetup) return false;
  bridge.openSetup();
  return true;
}
