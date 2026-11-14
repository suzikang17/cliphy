import type { AppState } from "./controller.js";

/** One short line for the menu-bar item and the top of the window. */
export function statusLine(state: AppState, now: Date): string {
  if (state.step === "pair") return "Not connected";
  if (state.step === "access") return "Needs access to Messages";
  if (state.error) return state.error;
  if (state.offline) return "No connection";
  if (!state.lastSyncAt) return "Connected";
  const minutes = Math.floor((now.getTime() - Date.parse(state.lastSyncAt)) / 60_000);
  if (minutes < 1) return "Connected · checked just now";
  if (minutes < 60) return `Connected · checked ${minutes} min ago`;
  return `Connected · checked ${Math.floor(minutes / 60)} h ago`;
}
