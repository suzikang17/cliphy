import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tabs } from "wxt/browser";
import { isAuthenticated } from "../auth";
import { AuthError, RateLimitError, getTabHints, organizeTabs, putTabHint, stowTab } from "../api";
import {
  clearAssignments,
  clearDone,
  getCachedExtract,
  loadOrganizerState,
  saveAssignments,
  saveDismissed,
  saveExtract,
  setOverride,
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
  const [all, times, current] = await Promise.all([
    browser.tabs.query({}),
    loadOpenedTimes().catch(() => ({ opened: {}, trackingSince: null })),
    browser.windows.getCurrent().catch(() => null),
  ]);
  const currentWindowId = (current as { id?: number } | null)?.id ?? null;
  const list = all
    .map((t: Tabs.Tab) => toOpenTab(t))
    .filter((t: OpenTab | null): t is OpenTab => t !== null)
    .map((t: OpenTab) => {
      // Every window has a front tab; only the one in the panel's window is "the tab you're on".
      const otherWindow = currentWindowId != null && t.windowId !== currentWindowId;
      return { ...t, openedAt: times.opened[t.id], otherWindow, active: t.active && !otherWindow };
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
      if (res.proposalKeywords && mounted.current) {
        setProposalKeywords((p) => ({ ...p, ...res.proposalKeywords }));
      }
      if (res.proposalReasons && mounted.current) {
        setProposalReasons((p) => ({ ...p, ...res.proposalReasons }));
      }
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
    () => applyGroupOrder(mergeGroups(tabs, state, keywords), groupOrder),
    [tabs, state, keywords, groupOrder],
  );

  useEffect(() => {
    void loadGroupOrder().then((o) => mounted.current && setGroupOrder(o));
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

  /** Stow each tab to the inbox, then close only the ones that saved. */
  const stowTabs = useCallback(async (list: OpenTab[]) => {
    const saved: OpenTab[] = [];
    for (const tab of list) {
      try {
        await stowTab(tab.url, false);
        saved.push(tab);
      } catch {
        // Duplicate or failed save — never close a tab we didn't save.
      }
    }
    await closeTabsAndAdvance(saved.map((t) => t.id));
    return saved.length;
  }, []);

  const moveTo = useCallback(
    async (tab: OpenTab, key: GroupKey) => {
      await setOverride(tab.url, key);
      await reloadState();
    },
    [reloadState],
  );

  const dismissProposal = useCallback(
    async (name: string) => {
      const next = new Set(stateRef.current.dismissed).add(name);
      await saveDismissed(next);
      await reloadState();
    },
    [reloadState],
  );

  /** Keep a suggested group as a tag — under Claude's name, or one you typed. */
  const saveAsTag = useCallback(
    async (name: string, rename?: string) => {
      const tag = normalizeTagName(rename ?? name) || name;
      const suggested = proposalKeywords[name] ?? [];
      await putTabHint(tag, "", { keep: true, keywords: suggested });
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
