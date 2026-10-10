import type { TabAssignment } from "@cliphy/shared";
import type { ExtractResult } from "./extractPage";
import type { GroupKey, OrganizerState } from "./organize";

/**
 * Tabs view cache, keyed by URL. Groupings, done flags, overrides, dismissed
 * suggestions and suggestion reasons live in `storage.local` so they survive
 * extension reloads/updates and browser restarts (storage.session is wiped on
 * every reload — the 2026-10-10 "lost all my groupings" bug). Entries carry a
 * timestamp; anything unseen for 30 days is ignored and pruned, and the cache
 * is capped at 2,000 pages. Extracted page text stays session-only (privacy,
 * size). Nothing here leaves the browser.
 */
const K = {
  extract: (url: string) => `tabs:extract:${url}`,
  assign: (url: string) => `tabs:assign:${url}`,
  done: (url: string) => `tabs:done:${url}`,
  override: (url: string) => `tabs:override:${url}`,
  dismissed: "tabs:dismissed",
  proposals: "tabs:proposals",
} as const;

const ASSIGN_PREFIX = "tabs:assign:";
const DONE_PREFIX = "tabs:done:";
export const CACHE_TTL_MS = 30 * 86_400_000;
export const CACHE_MAX_PAGES = 2000;

/** Stored form: value + when it was written (for expiry/pruning). */
interface Stamped<T> {
  v: T;
  at: number;
}
const stamp = <T>(v: T): Stamped<T> => ({ v, at: Date.now() });
const isStamped = (x: unknown): x is Stamped<unknown> =>
  !!x && typeof x === "object" && "at" in x && "v" in x;
/** Unwrap a stamped value; drop it when expired. Legacy (unstamped) values pass through. */
function fresh<T>(raw: unknown): T | undefined {
  if (raw === undefined) return undefined;
  if (!isStamped(raw)) return raw as T;
  return Date.now() - raw.at > CACHE_TTL_MS ? undefined : (raw.v as T);
}

/** Set by the background before opening the panel via the keyboard command. */
export const OPEN_TABS_VIEW_FLAG = "tabs:openRequested";

const session = () => browser.storage.session;
const local = () => browser.storage.local;

/** Load organizer state for the given URLs in two storage reads. */
export async function loadOrganizerState(urls: string[]): Promise<OrganizerState> {
  const unique = [...new Set(urls)];
  const keys = [...unique.flatMap((u) => [K.assign(u), K.done(u), K.override(u)]), K.dismissed];
  // Local is the store; session is read only for entries saved by the previous version.
  const [s, l] = await Promise.all([
    session().get(keys) as Promise<Record<string, unknown>>,
    local().get(keys) as Promise<Record<string, unknown>>,
  ]);
  const pick = <T>(key: string) => fresh<T>(l[key]) ?? fresh<T>(s[key]);

  const state: OrganizerState = {
    assignments: {},
    done: new Set(),
    overrides: {},
    dismissed: new Set(pick<string[]>(K.dismissed) ?? []),
  };
  for (const url of unique) {
    const a = pick<TabAssignment>(K.assign(url));
    if (a) state.assignments[url] = a;
    if (pick(K.done(url))) state.done.add(url);
    const o = pick<GroupKey>(K.override(url));
    if (o) state.overrides[url] = o;
  }
  return state;
}

export async function saveAssignments(
  assignments: Record<string, TabAssignment>,
  doneUrls: string[],
): Promise<void> {
  const items: Record<string, unknown> = {};
  for (const [url, a] of Object.entries(assignments)) items[K.assign(url)] = stamp(a);
  for (const url of doneUrls) items[K.done(url)] = stamp(true);
  if (Object.keys(items).length) await local().set(items);
}

/** Forget server assignments (e.g. after content reading is granted, to re-classify). */
export async function clearAssignments(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const keys = urls.map(K.assign);
  await Promise.all([local().remove(keys), session().remove(keys)]);
}

export async function clearDone(url: string): Promise<void> {
  await Promise.all([local().remove(K.done(url)), session().remove(K.done(url))]);
}

/** Manual Move-to. Also clears the done flag — the user clearly still wants the tab. */
export async function setOverride(url: string, key: GroupKey): Promise<void> {
  await Promise.all([
    session().set({ [K.override(url)]: key }),
    local().set({ [K.override(url)]: key }),
    clearDone(url),
  ]);
}

export async function saveDismissed(names: Set<string>): Promise<void> {
  await local().set({ [K.dismissed]: [...names] });
}

export async function getCachedExtract(url: string): Promise<ExtractResult | null> {
  const r = (await session().get(K.extract(url))) as Record<string, unknown>;
  return (r[K.extract(url)] as ExtractResult | undefined) ?? null;
}

export async function saveExtract(url: string, data: ExtractResult): Promise<void> {
  await session().set({ [K.extract(url)]: data });
}

/** Undo a Move-to/merge: restore a page's previous override (or none). */
export async function restoreOverride(url: string, key: GroupKey | undefined): Promise<void> {
  if (key) {
    await Promise.all([
      session().set({ [K.override(url)]: key }),
      local().set({ [K.override(url)]: key }),
    ]);
  } else {
    await Promise.all([session().remove(K.override(url)), local().remove(K.override(url))]);
  }
}

export interface StoredProposal {
  reason?: string;
  keywords?: string[];
  at?: number;
}

/** Suggestion reasons/keywords, so a reload doesn't blank the "Why:" line. */
export async function loadProposals(): Promise<Record<string, StoredProposal>> {
  try {
    const r = await local().get(K.proposals);
    const all = (r?.[K.proposals] as Record<string, StoredProposal> | undefined) ?? {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(all).filter(([, p]) => !p.at || now - p.at <= CACHE_TTL_MS),
    );
  } catch {
    return {};
  }
}

export async function saveProposals(update: Record<string, StoredProposal>): Promise<void> {
  const current = await loadProposals();
  const now = Date.now();
  for (const [name, p] of Object.entries(update)) {
    current[name] = { ...current[name], ...p, at: now };
  }
  await local().set({ [K.proposals]: current });
}

/** Housekeeping: drop expired groupings/done flags and keep only the newest 2,000 pages. */
export async function pruneTabsCache(): Promise<void> {
  try {
    const all = ((await local().get(null)) ?? {}) as Record<string, unknown>;
    const now = Date.now();
    const drop: string[] = [];
    const kept: { key: string; at: number }[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(ASSIGN_PREFIX) && !key.startsWith(DONE_PREFIX)) continue;
      const at = isStamped(value) ? value.at : 0;
      if (now - at > CACHE_TTL_MS) drop.push(key);
      else if (key.startsWith(ASSIGN_PREFIX)) kept.push({ key, at });
    }
    kept.sort((a, b) => b.at - a.at);
    for (const { key } of kept.slice(CACHE_MAX_PAGES)) {
      drop.push(key, DONE_PREFIX + key.slice(ASSIGN_PREFIX.length));
    }
    if (drop.length) await local().remove(drop);
  } catch {
    // best-effort housekeeping
  }
}
