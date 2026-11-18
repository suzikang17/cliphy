import AsyncStorage from "@react-native-async-storage/async-storage";

// When each project was last looked at, kept on this device. It is what makes
// a task "new": added since the owner last opened the project it belongs to.

const KEY = "cliphy:coach:seen:v1";

export type Seen = Record<string, string>;

export async function loadSeen(): Promise<Seen> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Seen) : {};
  } catch {
    return {};
  }
}

/**
 * Give every project not yet recorded a starting point of now, so only what
 * arrives from here on counts as new. Returns the record as it then stands.
 */
export async function startSeeing(projectIds: string[]): Promise<Seen> {
  const seen = await loadSeen();
  const missing = projectIds.filter((id) => !seen[id]);
  if (missing.length === 0) return seen;
  const now = new Date().toISOString();
  for (const id of missing) seen[id] = now;
  await AsyncStorage.setItem(KEY, JSON.stringify(seen)).catch(() => {});
  return seen;
}

/** Record that a project was looked at now. Returns when it had been looked at before. */
export async function markSeen(projectId: string): Promise<string | undefined> {
  const seen = await loadSeen();
  const before = seen[projectId];
  seen[projectId] = new Date().toISOString();
  await AsyncStorage.setItem(KEY, JSON.stringify(seen)).catch(() => {});
  return before;
}
