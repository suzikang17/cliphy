import { Platform } from "react-native";

/**
 * True when this is the copy of the app that runs in the Mac window.
 *
 * The web build has one use: the Mac app loads it. There it needs no sign-in:
 * the Mac app answers every /api/ call itself and adds the Mac's own key.
 */
export const DESKTOP = Platform.OS === "web";

/** What the Mac app lets the page ask of it. Absent in a plain browser. */
interface MacBridge {
  openSetup?: () => void;
}

/** Open the Mac's own screen: who is captured from Messages, and the connection. */
export function openMacSetup(): boolean {
  const bridge = (globalThis as { helper?: MacBridge }).helper;
  if (!bridge?.openSetup) return false;
  bridge.openSetup();
  return true;
}
