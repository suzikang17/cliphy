import type { OrganizeTabsResponse, TabAssignment, TabInput } from "@cliphy/shared";
import { tagPath, matchKeywordTag } from "@cliphy/shared";
import { isSkipped, type ExtractResult } from "./extractPage";
import { siteGroups } from "./siteGroups";
import { hostOf, type OpenTab } from "./types";

/** Max tabs per organize request (server enforces the same cap). */
export const MAX_ORGANIZE_BATCH = 60;

export type GroupKind = "tag" | "proposed" | "site" | "done";

/**
 * Stable group id. Also the value stored for a manual Move-to override.
 * Formats: `tag:<tag>`, `proposed:<name>`, `site:<host>`, `done`.
 */
export type GroupKey = string;

export const DONE_GROUP: GroupKey = "done";

export function groupKey(kind: Exclude<GroupKind, "done">, value: string): GroupKey {
  return `${kind}:${value}`;
}

export function parseGroupKey(key: GroupKey): { kind: GroupKind; value: string } {
  if (key === DONE_GROUP) return { kind: "done", value: "" };
  const i = key.indexOf(":");
  const kind = key.slice(0, i) as GroupKind;
  return { kind, value: key.slice(i + 1) };
}

export function groupLabel(key: GroupKey): string {
  const { kind, value } = parseGroupKey(key);
  if (kind === "done") return "Probably done";
  if (kind === "site") return value;
  return tagPath(value).join(" › ");
}

export interface TabGroup {
  key: GroupKey;
  kind: GroupKind;
  /** Tag / proposed name / host; "" for the done group. */
  value: string;
  label: string;
  tabs: OpenTab[];
}

/** Everything the merge needs, all keyed by URL. */
export interface OrganizerState {
  assignments: Record<string, TabAssignment>;
  done: Set<string>;
  overrides: Record<string, GroupKey>;
  /** Proposed group names the user dismissed with ×. */
  dismissed: Set<string>;
}

export function emptyOrganizerState(): OrganizerState {
  return { assignments: {}, done: new Set(), overrides: {}, dismissed: new Set() };
}

/**
 * Where one tab goes. Precedence: manual override > done flag > server
 * assignment > site group. A dismissed proposal falls back to the site group.
 */
export function resolveGroup(
  tab: OpenTab,
  state: OrganizerState,
  /** Per-tag keywords — a deterministic, instant match that beats the server's answer. */
  keywords: Record<string, string[]> = {},
): GroupKey {
  const site = groupKey("site", hostOf(tab.url));
  const override = state.overrides[tab.url];
  if (override) return override;
  if (state.done.has(tab.url)) return DONE_GROUP;
  const keywordTag = matchKeywordTag(tab, keywords);
  if (keywordTag) return groupKey("tag", keywordTag);
  const a = state.assignments[tab.url];
  if (a && "tag" in a) return groupKey("tag", a.tag);
  if (a && "proposed" in a && !state.dismissed.has(a.proposed)) {
    return groupKey("proposed", a.proposed);
  }
  return site;
}

const byRecent = (a: OpenTab, b: OpenTab) => b.lastAccessed - a.lastAccessed;

/**
 * Merge open tabs with cached organizer state into display groups.
 * Order: groups holding an active tab first, then by most recent lastAccessed;
 * "Probably done" always last. Rows by lastAccessed desc.
 */
export function mergeGroups(
  tabs: OpenTab[],
  state: OrganizerState,
  keywords: Record<string, string[]> = {},
): TabGroup[] {
  const map = new Map<GroupKey, OpenTab[]>();
  // Site grouping is the base layer; walk it so host parsing lives in one place.
  for (const site of siteGroups(tabs)) {
    for (const tab of site.tabs) {
      const key = resolveGroup(tab, state, keywords);
      const list = map.get(key);
      if (list) list.push(tab);
      else map.set(key, [tab]);
    }
  }

  const groups: TabGroup[] = [...map].map(([key, list]) => {
    const { kind, value } = parseGroupKey(key);
    return { key, kind, value, label: groupLabel(key), tabs: [...list].sort(byRecent) };
  });

  const hasActive = (g: TabGroup) => g.tabs.some((t) => t.active);
  const recent = (g: TabGroup) => g.tabs[0]?.lastAccessed ?? 0;
  return groups.sort((a, b) => {
    if (a.kind === "done" || b.kind === "done") {
      return (a.kind === "done" ? 1 : 0) - (b.kind === "done" ? 1 : 0);
    }
    const act = Number(hasActive(b)) - Number(hasActive(a));
    if (act !== 0) return act;
    return recent(b) - recent(a);
  });
}

/**
 * Which tabs to send to the server this pass: URLs with no cached assignment
 * and no manual override, one tab per URL, most recently accessed first,
 * capped at 60. The rest stay in site groups until the next pass.
 */
export function selectTabsToSend(
  tabs: OpenTab[],
  state: Pick<OrganizerState, "assignments" | "overrides">,
  max = MAX_ORGANIZE_BATCH,
): OpenTab[] {
  const seen = new Set<string>();
  const out: OpenTab[] = [];
  for (const tab of [...tabs].sort(byRecent)) {
    if (seen.has(tab.url)) continue;
    seen.add(tab.url);
    if (state.assignments[tab.url] || state.overrides[tab.url]) continue;
    out.push(tab);
    if (out.length >= max) break;
  }
  return out;
}

/** Read page content only when granted and the tab is actually loaded. */
export function shouldExtract(tab: OpenTab, hasContentPermission: boolean): boolean {
  return hasContentPermission && !tab.discarded;
}

/**
 * Build the request item. Falls back to title + URL only when there is no
 * extraction (no permission, discarded tab, injection failed) or the page was
 * skipped as sensitive.
 */
export function buildTabInput(tab: OpenTab, extracted: ExtractResult | null): TabInput {
  const base: TabInput = { key: String(tab.id), url: tab.url, title: tab.title };
  if (!extracted || isSkipped(extracted)) return base;
  return {
    ...base,
    title: tab.title || extracted.title,
    ...(extracted.description ? { description: extracted.description } : {}),
    ...(extracted.text ? { text: extracted.text } : {}),
    scrolledToEnd: extracted.scrolledToEnd,
  };
}

/**
 * Map a keyed server response back to URLs. Keys the server left out get
 * `{ none: true }` so they are not resent forever.
 */
export function applyOrganizeResponse(
  sent: OpenTab[],
  res: OrganizeTabsResponse,
): { assignments: Record<string, TabAssignment>; done: string[] } {
  const doneKeys = new Set(res.done);
  const assignments: Record<string, TabAssignment> = {};
  const done: string[] = [];
  for (const tab of sent) {
    const key = String(tab.id);
    assignments[tab.url] = res.assignments[key] ?? { none: true };
    if (doneKeys.has(key)) done.push(tab.url);
  }
  return { assignments, done };
}

/** Move-to targets: every non-done group currently shown, plus known tags. */
export function moveTargets(groups: TabGroup[], knownTags: string[]): GroupKey[] {
  const keys = new Set<GroupKey>();
  for (const g of groups) if (g.kind !== "done") keys.add(g.key);
  for (const t of knownTags) keys.add(groupKey("tag", t));
  return [...keys];
}
