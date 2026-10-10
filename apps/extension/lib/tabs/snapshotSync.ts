import { closeGroupSnapshot, resumeGroup as deleteGroupSnapshot } from "../api";
import { isAuthenticated } from "../auth";
import type { Snapshots } from "./groupSnapshots";

/** Send changed snapshots to the server and delete removed ones. Returns the keys that failed. */
export async function pushSnapshots(snaps: Snapshots, keys: string[]): Promise<string[]> {
  if (keys.length === 0 || !(await isAuthenticated().catch(() => false))) return keys;
  const failed: string[] = [];
  for (const key of keys) {
    const s = snaps[key];
    try {
      if (s) await closeGroupSnapshot(s.key, s.label, s.pages);
      else await deleteGroupSnapshot(key);
    } catch {
      if (s) failed.push(key); // a delete of a row the server doesn't have is fine to drop
    }
  }
  return failed;
}
