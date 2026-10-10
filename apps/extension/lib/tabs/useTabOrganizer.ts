import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tabs } from "wxt/browser";
import { isAuthenticated } from "../auth";
import {
  AuthError,
  RateLimitError,
  getClosedGroups,
  getTabHints,
  organizeTabs,
  putPageOverrides,
  putTabHint,
  stowTab,
} from "../api";
import type { PagePin } from "./pins";
import { NEW_WINDOW_ABOVE, pagesToResume } from "./closedGroups";
import {
  SNAPSHOTS_KEY,
  autosave,
  closedView,
  loadSnapshots,
  markClosed,
  markResumed,
  saveSnapshots,
  type Snapshots,
} from "./groupSnapshots";
import { pushSnapshots } from "./snapshotSync";
import { normalizeUrl } from "./dedupe";
import { createOrderMemo, reseedGroups, stableOrder } from "./stableOrder";

export type SaveStatus = "saving" | "saved" | "local";

/** Autosaved group changes go to the server after this quiet period. */
export const AUTOSAVE_PUSH_MS = 1500;
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
/** Longest we wait for one tab's page text before sending title + address only. */
export const EXTRACT_TIMEOUT_MS = 2000;

async function extractFor(tab: OpenTab, granted: boolean): Promise<ExtractResult | null> {
  if (!shouldExtract(tab, granted)) return null;
  const cached = await getCachedExtract(tab.url);
  if (cached) return cached;
  try {
    // A tab that's asleep or still loading (e.g. right after a restart) may never
    // answer; give up on its text rather than stall organizing forever.
    const injected = browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS),
    );
    const out = await Promise.race([injected, timeout]);
    if (!out) return null;
    const [res] = out;
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
  /** Autosaved tag groups (see groupSnapshots.ts); closed groups are derived from them. */
  const [snaps, setSnaps] = useState<Snapshots>({});

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

  // Order sticks while the panel is open (see stableOrder.ts); your own group
  // order (drag / reset) re-seeds the group positions.
  const orderMemo = useRef(createOrderMemo());
  const lastGroupOrder = useRef(groupOrder);
  const groups: TabGroup[] = useMemo(() => {
    if (lastGroupOrder.current !== groupOrder) {
      lastGroupOrder.current = groupOrder;
      reseedGroups(orderMemo.current);
    }
    return stableOrder(
      applyGroupOrder(mergeGroups(tabs, state, keywords, aliases), groupOrder),
      orderMemo.current,
    );
  }, [tabs, state, keywords, aliases, groupOrder]);

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

  // ── Autosaved groups ──────────────────────────────────────
  /** Per group: saving, saved (on the server), or local (only on this device so far). */
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const markStatus = useCallback((keys: string[], status: SaveStatus) => {
    if (keys.length === 0 || !mounted.current) return;
    setSaveStatus((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = status;
      return next;
    });
  }, []);
  /** Push now; returns the keys that didn't reach the server. */
  const pushNow = useCallback(
    async (snapshots: Snapshots, keys: string[]) => {
      if (keys.length === 0) return [];
      markStatus(keys, "saving");
      const failed = await pushSnapshots(snapshots, keys).catch(() => keys);
      markStatus(
        keys.filter((k) => !failed.includes(k)),
        "saved",
      );
      markStatus(failed, "local");
      return failed;
    },
    [markStatus],
  );
  const pendingPush = useRef(new Set<string>());
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePush = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return;
      for (const k of keys) pendingPush.current.add(k);
      markStatus(keys, "saving");
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        const batch = [...pendingPush.current];
        pendingPush.current.clear();
        void loadSnapshots()
          .then((latest) => pushNow(latest, batch))
          .then((failed) => failed.forEach((k) => pendingPush.current.add(k)))
          .catch(() => {});
      }, AUTOSAVE_PUSH_MS);
    },
    [markStatus, pushNow],
  );

  /** Local snapshots ∪ the server's (another device's groups); local-only ones go up. */
  const refreshClosedGroups = useCallback(async () => {
    let local = await loadSnapshots();
    if (authedRef.current) {
      try {
        const server = (await getClosedGroups()).groups;
        local = await loadSnapshots(); // autosave may have written meanwhile
        const onServer = new Set(server.map((g) => g.key));
        for (const g of server) {
          const at = Date.parse(g.closedAt);
          const mine = local[g.key];
          if (!mine || at > mine.updatedAt) {
            local[g.key] = {
              key: g.key,
              label: g.label,
              pages: g.pages,
              updatedAt: at,
              ...(mine?.closedAt !== undefined && { closedAt: mine.closedAt }),
            };
          }
        }
        await saveSnapshots(local);
        markStatus([...onServer], "saved");
        schedulePush(Object.keys(local).filter((k) => !onServer.has(k)));
      } catch {
        // offline — the local copy stands
      }
    }
    if (mounted.current) setSnaps(local);
  }, [schedulePush, markStatus]);

  useEffect(() => {
    if (authed === null) return;
    void refreshClosedGroups();
  }, [authed, refreshClosedGroups]);

  // The background prunes pages you close on purpose; follow its writes.
  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && SNAPSHOTS_KEY in changes && mounted.current) {
        setSnaps((changes[SNAPSHOTS_KEY].newValue as Snapshots | undefined) ?? {});
      }
    };
    browser.storage.onChanged?.addListener(onChanged);
    return () => browser.storage.onChanged?.removeListener(onChanged);
  }, []);

  const closedGroups = useMemo(
    () =>
      closedView(
        snaps,
        tabs.map((t) => t.url),
      ),
    [snaps, tabs],
  );

  /**
   * ⇧C: the group is already autosaved — save it once more, mark it closed so
   * its pages stay when the tabs go, then close the tabs.
   */
  const closeGroup = useCallback(
    async (group: TabGroup) => {
      if (group.tabs.length === 0) return;
      const now = Date.now();
      const folded = autosave(await loadSnapshots(), [group], now);
      const saved = folded.next;
      schedulePush([...folded.changed, ...folded.removed].filter((k) => k !== group.key));
      const next = saved[group.key]
        ? markClosed(saved, group.key, now)
        : {
            ...saved,
            [group.key]: {
              key: group.key,
              label: group.label,
              pages: group.tabs.map((t) => ({ url: t.url, title: t.customTitle || t.title })),
              updatedAt: now,
              closedAt: now,
            },
          };
      await saveSnapshots(next);
      setSnaps(next);
      await pushNow(next, [group.key]);
      await closeTabsAndAdvance(group.tabs.map((t) => t.id));
      await refreshTabs(); // so it moves to Closed groups right away
    },
    [pushNow, refreshTabs],
  );

  /** Reopen a closed group: its pages + the given pinned pages, minus what's already open. */
  const resumeGroup = useCallback(
    async (key: string, pinned: PagePin[]) => {
      const current = await loadSnapshots();
      const pages = pagesToResume(
        current[key]?.pages ?? [],
        pinned,
        tabsRef.current.map((t) => t.url),
      );
      const next = markResumed(current, key);
      await saveSnapshots(next);
      setSnaps(next);
      if (pages.length > NEW_WINDOW_ABOVE) {
        await browser.windows.create({ url: pages.map((p) => p.url) });
      } else {
        for (const p of pages) await browser.tabs.create({ url: p.url, active: false });
      }
      await refreshTabs();
    },
    [refreshTabs],
  );

  /** Remove a closed group for good (here and on the server). */
  const forgetGroup = useCallback(async (key: string) => {
    const next = { ...(await loadSnapshots()) };
    delete next[key];
    await saveSnapshots(next);
    setSnaps(next);
    await pushSnapshots(next, [key]);
  }, []);

  /** The save button: fold the group in and send it to the server now. */
  const saveGroupNow = useCallback(
    async (group: TabGroup) => {
      const { next, changed, removed } = autosave(await loadSnapshots(), [group], Date.now());
      await saveSnapshots(next);
      if (mounted.current) setSnaps(next);
      const keys = [...new Set([group.key, ...changed, ...removed])];
      if (next[group.key]) await pushNow(next, keys);
    },
    [pushNow],
  );

  /** Per group: the (normalized) pages in its saved copy — what comes back after a restart. */
  const savedPages = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const s of Object.values(snaps)) {
      out[s.key] = new Set(s.pages.map((p) => normalizeUrl(p.url) ?? p.url));
    }
    return out;
  }, [snaps]);

  // Autosave: whenever the tag groups change, fold them into their snapshots.
  useEffect(() => {
    if (status === "organizing" || groups.length === 0) return;
    void (async () => {
      const { next, changed, removed } = autosave(await loadSnapshots(), groups, Date.now());
      if (changed.length === 0 && removed.length === 0) return;
      await saveSnapshots(next);
      if (mounted.current) setSnaps(next);
      schedulePush([...changed, ...removed]);
    })();
  }, [groups, status, schedulePush]);

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
    forgetGroup,
    saveGroupNow,
    saveStatus,
    savedPages,
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
