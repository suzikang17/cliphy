import { BUNDLE_QUIET_MS, type BundleStatus, type Direction } from "@cliphy/shared";

export interface OpenBundle {
  id: string;
  status: BundleStatus;
  lastMessageAt: string;
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
 */
export function pickBundle(
  open: OpenBundle | null,
  direction: Direction,
  sentAt: string,
  quietMs: number = BUNDLE_QUIET_MS,
): "append" | "new" | "none" {
  if (direction === "out") return "none";
  if (!open || open.status !== "collecting") return "new";
  const gap = Math.abs(Date.parse(sentAt) - Date.parse(open.lastMessageAt));
  return gap <= quietMs ? "append" : "new";
}
