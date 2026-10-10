import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tabs } from "wxt/browser";
import { isAuthenticated } from "../auth";
import {
  AuthError,
  RateLimitError,
  closeGroupSnapshot,
  getClosedGroups,
  getTabHints,
  organizeTabs,
  putPageOverrides,
  putTabHint,
  resumeGroup as resumeGroupApi,
  stowTab,
} from "../api";
import type { ClosedGroup, ClosedGroupPage } from "@cliphy/shared";
import type { PagePin } from "./pins";
import {
  NEW_WINDOW_ABOVE,
  cacheClosedGroups,
  loadCachedClosedGroups,
  loadResumePending,
  pagesToResume,
  saveResumePending,
} from "./closedGroups";
import {
  clearAssignments,
  clearDone,
  getCachedExtract,
  loadOrganizerState,
  saveAssignments,
  saveDismissed,
  saveExtract,
  setOverride,
  restoreOverride,
  loadProposals,
  saveProposals,
  pruneTabsCache,
} from "./cache";
import { extractPage, type ExtractResult } from "./extractPage";
import {
  MAX_ORGANIZE_BATCH,
  applyOrganizeResponse,
  buildTabInput,
  emptyOrganizerState,
  mergeGroups,
  selectTabsToSend,
  shouldExtract,
  type GroupKey,
  type OrganizerState,
  type TabGroup,
} from "./organize";
import { toOpenTab, type OpenTab } from "./types";
import { loadOpenedTimes } from "./openedAt";
import { closeTabsAndAdvance } from "./nextTab";
import { activateTab } from "./activate";
import { combineMeta, loadTagAliases, saveTagAliases } from "./merge";
import { loadAllTabMeta, metaFor, setTabMeta, type TabMeta } from "./tabMeta";
import { loadActivity } from "./activity";
import { buildClusters } from "./clusters";
import {
  applyGroupOrder,
  loadGroupOrder,
  nudgeGroup,
  reorderGroups,
  saveGroupOrder,
} from "./groupOrder";

/** AI organize waits for tab activity to settle this long. */
export const ORGANIZE_DEBOUNCE_MS = 3000;

export const CONTENT_PERMISSION = { permissions: ["scripting"], origins: ["<all_urls>"] };

export type OrganizeStatus = "idle" | "organizing" | "error";

async function queryOpenTabs(): Promise<{
  list: OpenTab[];
  trackingSince: number | null;
  currentWindowId: number | null;
}> {
  const [all, times, current, meta] = await Promise.all([
    browser.tabs.query({}),
    loadOpenedTimes().catch(() => ({ opened: {}, trackingSince: null })),
    browser.windows.getCurrent().catch(() => null),
    loadAllTabMeta(),
  ]);
  const currentWindowId = (current as { id?: number } | null)?.id ?? null;
  const list = all
    .map((t: Tabs.Tab) => toOpenTab(t))
    .filter((t: OpenTab | null): t is OpenTab => t !== null)
    .map((t: OpenTab) => {
      // Every window has a front tab; only the one in the panel's window is "the tab you're on".
      const otherWindow = currentWindowId != null && t.windowId !== currentWindowId;
      const { title: customTitle, note } = metaFor(meta, t.url);
      return {
        ...t,
        openedAt: times.opened[t.id],
        otherWindow,
        active: t.active && !otherWindow,
        ...(customTitle && { customTitle }),
        ...(note && { note }),
      };
    });
  return { list, trackingSince: times.trackingSince, currentWindowId };
}

async function hasContentPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains(CONTENT_PERMISSION);
  } catch {
    return false;
  }
}

/** "Freelance : Lotus Bech" → "freelance:lotus bech" (tags are lowercase, ":" nests). */
export function normalizeTagName(raw: string): string {
  return raw
    .toLowerCase()
    .split(":")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(":")
    .slice(0, 30);
}

/** Read one tab's page. null → send title + URL only. */
async function extractFor(tab: OpenTab, granted: boolean): Promise<ExtractResult | null> {
  if (!shouldExtract(tab, granted)) return null;
  const cached = await getCachedExtract(tab.url);
  if (cached) return cached;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    const result = res?.result as ExtractResult | undefined;
    if (!result) return null;
    await saveExtract(tab.url, result);
    return result;
  } catch {
    // Web Store, PDF viewer, error pages, revoked host access — title + URL only.
    return null;
  }
}

/**
 * Orchestrates the Tabs view: live open tabs → instant site groups → (signed
 * in) debounced POST /api/tabs/organize for uncached URLs → merged groups.
 */
export function useTabOrganizer() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [state, setState] = useState<OrganizerState>(emptyOrganizerState);
  const [contentGranted, setContentGranted] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<OrganizeStatus>("idle");
  const [hints, setHints] = useState<Record<string, string>>({});
  const [keywords, setKeywords] = useState<Record<string, string[]>>({});
  /** Claude's suggested keywords per proposed group, saved on "＋ Save as tag". */
  const [proposalKeywords, setProposalKeywords] = useState<Record<string, string[]>>({});
  /** Claude's one-line "why these belong together" per proposed group. */
  const [proposalReasons, setProposalReasons] = useState<Record<string, string>>({});
  const [trackingSince, setTrackingSince] = useState<number | null>(null);
  const [groupOrder, setGroupOrder] = useState<GroupKey[]>([]);
  /** Merged tags: { from: to }. */
  const [aliases, setAliases] = useState<Record<string, string>>({});
  /** Groups closed as a whole (server list ∪ local fallback), newest first. */
  const [closedGroups, setClosedGroups] = useState<ClosedGroup[]>([]);
  const closedRef = useRef<ClosedGroup[]>([]);
  closedRef.current = closedGroups;

  // Listeners and timers read the latest values through refs.
  const tabsRef = useRef(tabs);
  const stateRef = useRef(state);
  const grantedRef = useRef(contentGranted);
  const authedRef = useRef(authed);
  tabsRef.current = tabs;
  stateRef.current = state;
  grantedRef.current = contentGranted;
  authedRef.current = authed;

  const inFlight = useRef(false);
  /**
   * Tabs the panel itself just switched to. Clicking a row to peek at a
   * "Probably done" tab must not clear its done flag — only switching to it
   * yourself (outside the panel) means you're not done with it.
   */
  const peeking = useRef(new Set<number>());
  /** The browser window this panel belongs to. */
  const currentWindowRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const scheduleRef = useRef<() => void>(() => {});

  const reloadState = useCallback(async (list: OpenTab[] = tabsRef.current) => {
    const next = await loadOrganizerState(list.map((t) => t.url));
    if (!mounted.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const refreshTabs = useCallback(async () => {
    const { list, trackingSince: since, currentWindowId: win } = await queryOpenTabs();
    if (!mounted.current) return list;
    setTrackingSince(since);
    currentWindowRef.current = win;
    tabsRef.current = list;
    setTabs(list);
    await reloadState(list);
    return list;
  }, [reloadState]);

  const organize = useCallback(async () => {
    if (inFlight.current || !authedRef.current) return;
    const toSend = selectTabsToSend(tabsRef.current, stateRef.current);
    if (toSend.length === 0) return;

    inFlight.current = true;
    setStatus("organizing");
    let more = false;
    try {
      const granted = grantedRef.current;
      const t0 = performance.now();
      const inputs = await Promise.all(
        toSend.map(async (t) => buildTabInput(t, await extractFor(t, granted))),
      );
      // Evidence for grouping: which tabs were actually worked on together (local log).
      const activity = await loadActivity();
      const clusters = buildClusters(tabsRef.current, activity, Date.now());
      const t1 = performance.now();
      const res = await organizeTabs(inputs, clusters);
      console.debug("[Cliphy tabs] organize", {
        tabs: toSend.length,
        withText: inputs.filter((i) => i.text).length,
        extractMs: Math.round(t1 - t0),
        serverMs: Math.round(performance.now() - t1),
      });
      const { assignments, done } = applyOrganizeResponse(toSend, res);
      // Manual choices saved on the server (e.g. from another device) — local ones win.
      const remote = res.overrides ?? {};
      await Promise.all(
        toSend
          .filter((t) => remote[String(t.id)] && !stateRef.current.overrides[t.url])
          .map((t) => setOverride(t.url, remote[String(t.id)] as GroupKey)),
      );
      if (res.proposalKeywords && mounted.current) {
        setProposalKeywords((p) => ({ ...p, ...res.proposalKeywords }));
      }
      if (res.proposalReasons && mounted.current) {
        setProposalReasons((p) => ({ ...p, ...res.proposalReasons }));
      }
      const proposals: Record<string, { reason?: string; keywords?: string[] }> = {};
      for (const [name, keywords] of Object.entries(res.proposalKeywords ?? {})) {
        proposals[name] = { ...proposals[name], keywords };
      }
      for (const [name, reason] of Object.entries(res.proposalReasons ?? {})) {
        proposals[name] = { ...proposals[name], reason };
      }
      if (Object.keys(proposals).length) void saveProposals(proposals).catch(() => {});
      await saveAssignments(assignments, done);
      await reloadState();
      if (mounted.current) setStatus("idle");
      more = toSend.length >= MAX_ORGANIZE_BATCH;
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof RateLimitError) {
        setStatus("idle"); // keep the cache; next debounce window tries again
      } else if (err instanceof AuthError) {
        setAuthed(false);
        authedRef.current = false;
        setStatus("idle");
      } else {
        setStatus("error");
      }
    } finally {
      inFlight.current = false;
    }
    // More than one batch of uncached tabs: the rest go in the next pass.
    if (more && mounted.current) scheduleRef.current();
  }, [reloadState]);

  const scheduleOrganize = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void organize(), ORGANIZE_DEBOUNCE_MS);
  }, [organize]);
  scheduleRef.current = scheduleOrganize;

  // ── Mount: initial load ─────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const [isAuthed, granted] = await Promise.all([
        isAuthenticated().catch(() => false),
        hasContentPermission(),
      ]);
      if (!mounted.current) return;
      setAuthed(isAuthed);
      authedRef.current = isAuthed;
      setContentGranted(granted);
      grantedRef.current = granted;
      await refreshTabs();
      if (isAuthed) {
        getTabHints()
          .then((r) => {
            if (!mounted.current) return;
            setHints(r.hints ?? {});
            setKeywords(r.keywords ?? {});
          })
          .catch(() => {});
        void organize();
      }
    })();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refreshTabs, organize]);

  // ── Live updates while mounted ──────────────────────────────
  useEffect(() => {
    const onCreated = () => {
      void refreshTabs();
      scheduleOrganize();
    };
    const onRemoved = () => void refreshTabs();
    const onUpdated = (_id: number, change: Tabs.OnUpdatedChangeInfoType) => {
      if (
        change.url === undefined &&
        change.title === undefined &&
        change.status === undefined &&
        change.favIconUrl === undefined &&
        change.discarded === undefined
      ) {
        return;
      }
      void refreshTabs();
      if (change.url !== undefined || change.status === "complete") scheduleOrganize();
    };
    const onActivated = async ({ tabId }: { tabId: number }) => {
      const peek = peeking.current.delete(tabId);
      const list = await refreshTabs();
      if (peek) return;
      const tab = list.find((t) => t.id === tabId);
      // Looking at a tab again means the user isn't done with it.
      if (tab && stateRef.current.done.has(tab.url)) {
        await clearDone(tab.url);
        await reloadState();
      }
    };
    const onPermissionChange = async () => {
      const granted = await hasContentPermission();
      setContentGranted(granted);
      grantedRef.current = granted;
    };

    browser.tabs.onCreated.addListener(onCreated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    browser.permissions.onRemoved.addListener(onPermissionChange);
    browser.permissions.onAdded.addListener(onPermissionChange);
    return () => {
      browser.tabs.onCreated.removeListener(onCreated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.permissions.onRemoved.removeListener(onPermissionChange);
      browser.permissions.onAdded.removeListener(onPermissionChange);
    };
  }, [refreshTabs, reloadState, scheduleOrganize]);

  const groups: TabGroup[] = useMemo(
    () => applyGroupOrder(mergeGroups(tabs, state, keywords, aliases), groupOrder),
    [tabs, state, keywords, aliases, groupOrder],
  );

  useEffect(() => {
    void loadGroupOrder().then((o) => mounted.current && setGroupOrder(o));
    void loadTagAliases().then((a) => mounted.current && setAliases(a));
    // Suggestion reasons/keywords survive reloads; tidy the cache while we're here.
    void loadProposals().then((p) => {
      if (!mounted.current) return;
      const kws: Record<string, string[]> = {};
      const reasons: Record<string, string> = {};
      for (const [name, v] of Object.entries(p)) {
        if (v.keywords?.length) kws[name] = v.keywords;
        if (v.reason) reasons[name] = v.reason;
      }
      setProposalKeywords((cur) => ({ ...kws, ...cur }));
      setProposalReasons((cur) => ({ ...reasons, ...cur }));
    });
    void pruneTabsCache();
  }, []);

  const updateOrder = useCallback((next: GroupKey[]) => {
    setGroupOrder(next);
    void saveGroupOrder(next).catch(() => {});
  }, []);

  /** Drag-and-drop: move `from` before/after `target`. */
  const reorder = useCallback(
    (from: GroupKey, target: GroupKey, position: "before" | "after") =>
      updateOrder(
        reorderGroups(
          groups.map((g) => g.key),
          groupOrder,
          from,
          target,
          position,
        ),
      ),
    [groups, groupOrder, updateOrder],
  );
  /** ⌥↑ / ⌥↓ */
  const nudge = useCallback(
    (key: GroupKey, dir: -1 | 1) =>
      updateOrder(
        nudgeGroup(
          groups.map((g) => g.key),
          groupOrder,
          key,
          dir,
        ),
      ),
    [groups, groupOrder, updateOrder],
  );
  const resetOrder = useCallback(() => updateOrder([]), [updateOrder]);

  /** Known tags for Move-to: saved hints plus tags the server assigned. */
  const knownTags = useMemo(() => {
    const set = new Set(Object.keys(hints));
    for (const a of Object.values(state.assignments)) if ("tag" in a) set.add(a.tag);
    return [...set].sort();
  }, [hints, state.assignments]);

  // ── Actions ─────────────────────────────────────────────────

  /** Must be called directly from a click — permissions.request needs the gesture. */
  const requestContent = useCallback(async () => {
    const granted = await browser.permissions.request(CONTENT_PERMISSION).catch(() => false);
    if (!granted) return;
    setContentGranted(true);
    grantedRef.current = true;
    // Re-classify what was organized from title + URL alone.
    await clearAssignments(tabsRef.current.map((t) => t.url));
    await reloadState();
    void organize();
  }, [organize, reloadState]);

  const activate = useCallback(
    async (tab: OpenTab) => {
      peeking.current.add(tab.id);
      await activateTab(tab, currentWindowRef.current);
      // A tab brought over from another window changed windows — refresh.
      if (tab.otherWindow) await refreshTabs();
    },
    [refreshTabs],
  );

  const closeTabs = useCallback(async (ids: number[]) => {
    await closeTabsAndAdvance(ids);
  }, []);

  /**
   * Server list ∪ local fallback. When online, also settles what the server
   * missed while offline: deletes rows for groups already resumed here, and
   * pushes snapshots that only exist locally.
   */
  const refreshClosedGroups = useCallback(async () => {
    let local = await loadCachedClosedGroups();
    let server: ClosedGroup[] = [];
    if (authedRef.current) {
      try {
        server = (await getClosedGroups()).groups;
        const serverKey = new Set(server.map((g) => g.key));
        // Resumed here but the server never heard: delete its row now, never show it again.
        const pending = (await loadResumePending()).filter((k) => serverKey.has(k));
        const stillPending: string[] = [];
        for (const key of pending) {
          try {
            await resumeGroupApi(key);
          } catch {
            stillPending.push(key);
          }
        }
        await saveResumePending(stillPending);
        server = server.filter((g) => !pending.includes(g.key));
        // A local snapshot newer than the server's (or the only one) goes up; older ones are dropped.
        const kept: ClosedGroup[] = [];
        for (const g of local) {
          const sv = server.find((x) => x.key === g.key);
          if (sv && sv.closedAt >= g.closedAt) continue;
          try {
            await closeGroupSnapshot(g.key, g.label, g.pages);
            server = [g, ...server.filter((x) => x.key !== g.key)];
          } catch {
            kept.push(g);
          }
        }
        if (kept.length !== local.length) await cacheClosedGroups(kept);
        local = kept;
      } catch {
        // offline — the local copy stands
      }
    }
    const keys = new Set(server.map((g) => g.key));
    const merged = [...server, ...local.filter((g) => !keys.has(g.key))].sort((a, b) =>
      b.closedAt.localeCompare(a.closedAt),
    );
    if (mounted.current) setClosedGroups(merged);
  }, []);

  useEffect(() => {
    if (authed === null) return;
    void refreshClosedGroups();
  }, [authed, refreshClosedGroups]);

  /**
   * Close a whole group: snapshot its open pages (server, best-effort; local
   * copy on failure), then close the tabs. The Trail captures them regardless.
   */
  const closeGroup = useCallback(async (group: TabGroup) => {
    const pages = group.tabs.map((t) => ({ url: t.url, title: t.customTitle || t.title }));
    if (pages.length === 0) return;
    let closedAt = new Date().toISOString();
    let saved = false;
    if (authedRef.current) {
      try {
        closedAt = (await closeGroupSnapshot(group.key, group.label, pages)).closedAt;
        saved = true;
      } catch {
        saved = false;
      }
    }
    const entry: ClosedGroup = { key: group.key, label: group.label, pages, closedAt };
    const next = [entry, ...closedRef.current.filter((g) => g.key !== group.key)];
    setClosedGroups(next);
    // Local copy only while the server doesn't have it — that's what Resume falls back to.
    const local = await loadCachedClosedGroups();
    const others = local.filter((g) => g.key !== group.key);
    if (!saved) await cacheClosedGroups([entry, ...others]);
    else {
      if (others.length !== local.length) await cacheClosedGroups(others);
      // The server row is this new snapshot now — don't delete it on the next load.
      const pending = await loadResumePending();
      if (pending.includes(group.key))
        await saveResumePending(pending.filter((k) => k !== group.key));
    }
    await closeTabsAndAdvance(group.tabs.map((t) => t.id));
  }, []);

  /** Reopen a closed group: its snapshot + the given pinned pages, minus what's already open. */
  const resumeGroup = useCallback(
    async (key: string, pinned: PagePin[]) => {
      let snapshot: ClosedGroupPage[] | null = null;
      if (authedRef.current) {
        try {
          snapshot = (await resumeGroupApi(key)).pages;
        } catch {
          snapshot = null;
          // The server may still hold this group; delete it on the next load.
          const pending = await loadResumePending();
          if (!pending.includes(key)) await saveResumePending([...pending, key]);
        }
      }
      if (!snapshot) snapshot = closedRef.current.find((g) => g.key === key)?.pages ?? [];
      const pages = pagesToResume(
        snapshot,
        pinned,
        tabsRef.current.map((t) => t.url),
      );
      if (pages.length > NEW_WINDOW_ABOVE) {
        await browser.windows.create({ url: pages.map((p) => p.url) });
      } else {
        for (const p of pages) await browser.tabs.create({ url: p.url, active: false });
      }
      const next = closedRef.current.filter((g) => g.key !== key);
      setClosedGroups(next);
      const local = await loadCachedClosedGroups();
      if (local.some((g) => g.key === key))
        await cacheClosedGroups(local.filter((g) => g.key !== key));
      await refreshTabs();
    },
    [refreshTabs],
  );

  /** Stow each tab to the inbox, then close only the ones that saved. */
  const stowTabs = useCallback(async (list: OpenTab[]) => {
    const saved: OpenTab[] = [];
    for (const tab of list) {
      try {
        await stowTab(tab.url, false, tab.note);
        saved.push(tab);
      } catch {
        // Duplicate or failed save — never close a tab we didn't save.
      }
    }
    await closeTabsAndAdvance(saved.map((t) => t.id));
    return saved.length;
  }, []);

  /** Best-effort server sync of manual choices; the local cache is the source of truth right away. */
  const syncOverrides = useCallback((items: { url: string; override: GroupKey | null }[]) => {
    if (!authedRef.current || items.length === 0) return;
    void putPageOverrides(items).catch(() => {});
  }, []);

  const moveTo = useCallback(
    async (tab: OpenTab, key: GroupKey) => {
      await setOverride(tab.url, key);
      syncOverrides([{ url: tab.url, override: key }]);
      await reloadState();
    },
    [reloadState, syncOverrides],
  );

  /** Put a page in a group by its address — e.g. before reopening it from the trail. */
  const placeUrl = useCallback(
    async (url: string, key: GroupKey) => {
      await setOverride(url, key);
      syncOverrides([{ url, override: key }]);
      await reloadState();
    },
    [reloadState, syncOverrides],
  );

  const dismissProposal = useCallback(
    async (name: string) => {
      const next = new Set(stateRef.current.dismissed).add(name);
      await saveDismissed(next);
      await reloadState();
    },
    [reloadState],
  );

  /**
   * Merge `source` into `target`: its tabs move there; for a tag target, the
   * source's keywords/hints join the target's and a source tag becomes an alias
   * of the target. Saved clips are untouched. Returns an undo.
   */
  const mergeGroup = useCallback(
    async (source: TabGroup, target: TabGroup): Promise<() => Promise<void>> => {
      const prevOverrides = source.tabs.map(
        (t) => [t.url, stateRef.current.overrides[t.url]] as const,
      );
      await Promise.all(source.tabs.map((t) => setOverride(t.url, target.key)));
      syncOverrides(source.tabs.map((t) => ({ url: t.url, override: target.key })));

      let undoMeta = async () => {};
      if (target.kind === "tag" && (source.kind === "tag" || source.kind === "proposed")) {
        const before = { hints: hints[target.value] ?? "", keywords: keywords[target.value] ?? [] };
        const from =
          source.kind === "tag"
            ? { hints: hints[source.value] ?? "", keywords: keywords[source.value] ?? [] }
            : { hints: "", keywords: proposalKeywords[source.value] ?? [] };
        const combined = combineMeta(before, from);
        const prevAliases = aliases;
        await putTabHint(target.value, combined.hints, { keep: true, keywords: combined.keywords });
        setHints((h) => ({ ...h, [target.value]: combined.hints }));
        setKeywords((k) => ({ ...k, [target.value]: combined.keywords }));
        if (source.kind === "tag") {
          const next = { ...aliases, [source.value]: target.value };
          setAliases(next);
          await saveTagAliases(next);
        }
        undoMeta = async () => {
          await putTabHint(target.value, before.hints, { keep: true, keywords: before.keywords });
          setHints((h) => ({ ...h, [target.value]: before.hints }));
          setKeywords((k) => ({ ...k, [target.value]: before.keywords }));
          setAliases(prevAliases);
          await saveTagAliases(prevAliases);
        };
      }
      await reloadState();

      return async () => {
        await Promise.all(prevOverrides.map(([url, key]) => restoreOverride(url, key)));
        syncOverrides(prevOverrides.map(([url, key]) => ({ url, override: key ?? null })));
        await undoMeta();
        await reloadState();
      };
    },
    [hints, keywords, proposalKeywords, aliases, reloadState, syncOverrides],
  );

  /** Rename a page and/or set its note (stored per page, locally). */
  const setMeta = useCallback(
    async (tab: OpenTab, patch: TabMeta) => {
      await setTabMeta(tab.url, patch);
      await refreshTabs();
    },
    [refreshTabs],
  );

  /** Keep a suggested group as a tag — under Claude's name, or one you typed. */
  const saveAsTag = useCallback(
    async (name: string, rename?: string) => {
      const tag = normalizeTagName(rename ?? name) || name;
      const suggested = proposalKeywords[name] ?? [];
      await putTabHint(tag, "", { keep: true, keywords: suggested, fromProposal: name });
      if (suggested.length) setKeywords((k) => ({ ...k, [tag]: suggested }));
      const promoted: Record<string, { tag: string }> = {};
      for (const [url, a] of Object.entries(stateRef.current.assignments)) {
        if ("proposed" in a && a.proposed === name) promoted[url] = { tag };
      }
      await saveAssignments(promoted, []);
      setHints((h) => ({ [tag]: "", ...h }));
      await reloadState();
    },
    [reloadState, proposalKeywords],
  );

  const saveHints = useCallback(async (tag: string, text: string, kws?: string[]) => {
    const trimmed = text.trim();
    const res = await putTabHint(tag, trimmed, kws ? { keywords: kws } : {});
    if (kws) {
      setKeywords((k) => {
        const next = { ...k };
        if (res.keywords?.length) next[tag] = res.keywords;
        else delete next[tag];
        return next;
      });
    }
    setHints((h) => {
      const next = { ...h };
      if (trimmed) next[tag] = trimmed;
      else delete next[tag];
      return next;
    });
  }, []);

  return {
    tabs,
    trackingSince,
    hasManualOrder: groupOrder.length > 0,
    reorder,
    nudge,
    resetOrder,
    keywords,
    proposalKeywords,
    proposalReasons,
    setMeta,
    mergeGroup,
    placeUrl,
    closedGroups,
    closeGroup,
    resumeGroup,
    refreshClosedGroups,
    groups,
    hints,
    knownTags,
    authed,
    status,
    contentGranted,
    retry: organize,
    requestContent,
    activate,
    closeTabs,
    stowTabs,
    moveTo,
    dismissProposal,
    saveAsTag,
    saveHints,
  };
}
