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
