import { BUNDLE_QUIET_MS, type BundleStatus, type Direction } from "@cliphy/shared";

export interface OpenBundle {
  id: string;
  status: BundleStatus;
  lastMessageAt: string;
  /** True when the bundle was read from a thread's past. */
  historical?: boolean;
}

/**
 * Decide where a newly captured message goes.
 *
 * - "append": joins `open` (same thought, sent close together).
 * - "new": starts a bundle.
 * - "none": outgoing messages are kept as thread context and never bundled.
 *
 * The time comparison is absolute, so a message that arrives out of order
 * (uploaded late but sent just before the bundle's last message) still joins.
 * A live message never joins a bundle read from the thread's past, or the
 * other way round: a historical bundle becomes closed history with nothing to
 * confirm, which would swallow a real request.
 */
export function pickBundle(
  open: OpenBundle | null,
  direction: Direction,
  sentAt: string,
  quietMs: number = BUNDLE_QUIET_MS,
  historical = false,
): "append" | "new" | "none" {
  if (direction === "out") return "none";
  if (!open || open.status !== "collecting") return "new";
  if ((open.historical === true) !== historical) return "new";
  const gap = Math.abs(Date.parse(sentAt) - Date.parse(open.lastMessageAt));
  return gap <= quietMs ? "append" : "new";
}
