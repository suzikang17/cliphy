import type { TabAssignment } from "@cliphy/shared";
import type { ExtractResult } from "./extractPage";
import type { GroupKey, OrganizerState } from "./organize";

/**
 * Tabs view cache. Everything lives in `storage.session` (cleared when the
 * browser closes) keyed by URL; manual Move-to overrides are mirrored into
 * `storage.local` so they survive restarts. Nothing here leaves the browser.
 */
const K = {
  extract: (url: string) => `tabs:extract:${url}`,
  assign: (url: string) => `tabs:assign:${url}`,
  done: (url: string) => `tabs:done:${url}`,
  override: (url: string) => `tabs:override:${url}`,
  dismissed: "tabs:dismissed",
} as const;

/** Set by the background before opening the panel via the keyboard command. */
export const OPEN_TABS_VIEW_FLAG = "tabs:openRequested";

const session = () => browser.storage.session;
const local = () => browser.storage.local;

/** Load organizer state for the given URLs in two storage reads. */
export async function loadOrganizerState(urls: string[]): Promise<OrganizerState> {
  const unique = [...new Set(urls)];
  const sessionKeys = [
    ...unique.flatMap((u) => [K.assign(u), K.done(u), K.override(u)]),
    K.dismissed,
  ];
  const [s, l] = await Promise.all([
    session().get(sessionKeys) as Promise<Record<string, unknown>>,
    local().get(unique.map(K.override)) as Promise<Record<string, unknown>>,
  ]);

  const state: OrganizerState = {
    assignments: {},
    done: new Set(),
    overrides: {},
    dismissed: new Set((s[K.dismissed] as string[] | undefined) ?? []),
  };
  for (const url of unique) {
    const a = s[K.assign(url)] as TabAssignment | undefined;
    if (a) state.assignments[url] = a;
    if (s[K.done(url)]) state.done.add(url);
    const o = (l[K.override(url)] ?? s[K.override(url)]) as GroupKey | undefined;
    if (o) state.overrides[url] = o;
  }
  return state;
}

export async function saveAssignments(
  assignments: Record<string, TabAssignment>,
  doneUrls: string[],
): Promise<void> {
  const items: Record<string, unknown> = {};
  for (const [url, a] of Object.entries(assignments)) items[K.assign(url)] = a;
  for (const url of doneUrls) items[K.done(url)] = true;
  if (Object.keys(items).length) await session().set(items);
}

/** Forget server assignments (e.g. after content reading is granted, to re-classify). */
export async function clearAssignments(urls: string[]): Promise<void> {
  if (urls.length) await session().remove(urls.map(K.assign));
}

export async function clearDone(url: string): Promise<void> {
  await session().remove(K.done(url));
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
  await session().set({ [K.dismissed]: [...names] });
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
