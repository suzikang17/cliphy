import { useEffect, useMemo, useRef, useState } from "react";
import { moveTargets as computeMoveTargets } from "../../lib/tabs/organize";
import { filterGroups, moveSelection, rowToActivate, visibleRows } from "../../lib/tabs/search";
import { useTabOrganizer } from "../../lib/tabs/useTabOrganizer";
import { useTrail } from "../../lib/trail/useTrail";
import { TabGroupSection } from "./TabGroupSection";
import { TrailSection } from "./TrailSection";
import { DuplicatesPanel } from "./DuplicatesPanel";
import { ShortcutHelp } from "./ShortcutHelp";
import { PinnedGroup } from "./PinnedGroup";
import { ClosedGroups } from "./ClosedGroups";
import { staleTabs } from "../../lib/tabs/stale";
import { useGroupNotes } from "../../lib/tabs/groupNotes";
import { useViewMode } from "../../lib/tabs/viewMode";
import { useTabSort } from "../../lib/tabs/useTabSort";
import { moveInOrder, sortTabs } from "../../lib/tabs/tabSort";
import { useTabPreviews } from "../../lib/tabs/previews";
import { useSavedByTag } from "../../lib/tabs/savedByTag";
import { openWebApp } from "../../lib/webApp";
import { WEB_ROUTES } from "@cliphy/shared";
import { countByFirstTag, groupCounts, pinsForGroup } from "../../lib/tabs/closedGroups";
import { listTrail } from "../../lib/api";
import type { TabGroup } from "../../lib/tabs/organize";
import { usePagePins } from "../../lib/tabs/pins";
import { normalizeUrl } from "../../lib/tabs/dedupe";
import { matchesQuery } from "../../lib/tabs/search";
import type { OpenTab } from "../../lib/tabs/types";
import { Kbd } from "./Kbd";
import { duplicateIdsToClose } from "../../lib/tabs/dedupe";
import { suggestKeywords } from "../../lib/tabs/keywordSuggest";
import {
  isTypingTarget,
  labelFor,
  LABEL_MODIFIER,
  resolveShortcut,
} from "../../lib/tabs/shortcuts";

interface TabsViewProps {
  /** Bumped by the parent when the keyboard command asks to focus search. */
  focusSignal?: number;
}

export function TabsView({ focusSignal = 0 }: TabsViewProps) {
  const org = useTabOrganizer();
  // Re-render every minute so "viewed 2m ago" doesn't go stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // While a group is being dragged, every group shows only its header so all
  // drop targets fit on screen.
  const [draggingGroup, setDraggingGroup] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Shortcut labels show only while ⌘ (Ctrl on Windows) is held.
  const [showLabels, setShowLabels] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Keyboard requests to open a row's Move picker / a group's editor (nonce re-triggers).
  const [moveRequest, setMoveRequest] = useState<{ tabId: number; n: number } | null>(null);
  const [mergeRequest, setMergeRequest] = useState<{ key: string; n: number } | null>(null);
  const [noteRequest, setNoteRequest] = useState<{ key: string; n: number } | null>(null);
  // Last merge, undoable for 10 seconds.
  const [lastMerge, setLastMerge] = useState<{ text: string; undo: () => Promise<void> } | null>(
    null,
  );
  useEffect(() => {
    if (!lastMerge) return;
    const id = setTimeout(() => setLastMerge(null), 10_000);
    return () => clearTimeout(id);
  }, [lastMerge]);

  async function mergeInto(fromKey: string, intoKey: string) {
    const source = org.groups.find((g) => g.key === fromKey);
    const target = org.groups.find((g) => g.key === intoKey);
    if (!source || !target || source.key === target.key) return;
    const undo = await org.mergeGroup(source, target);
    setLastMerge({ text: `Merged ${source.label} into ${target.label}`, undo });
  }

  const [metaRequest, setMetaRequest] = useState<{
    tabId: number;
    kind: "rename" | "note";
    n: number;
  } | null>(null);
  const [editRequest, setEditRequest] = useState<{ key: string; n: number } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === LABEL_MODIFIER) setShowLabels(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === LABEL_MODIFIER) setShowLabels(false);
    };
    // Releasing ⌘ outside the panel never fires keyup here — reset on blur.
    const reset = () => setShowLabels(false);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, [focusSignal]);

  const tabSort = useTabSort();
  // Each group's own sort (default: your order) applies before search + keyboard order.
  const shown = useMemo(
    () =>
      filterGroups(org.groups, query).map((g) => ({
        ...g,
        tabs: sortTabs(g.tabs, tabSort.sortFor(g.key), tabSort.orderFor(g.key)),
      })),
    [org.groups, query, tabSort.sortFor, tabSort.orderFor],
  );
  /** Put `tab` before `before` (null = end) in its group, switching that group to your order. */
  const reorderTab = (g: TabGroup, tab: OpenTab, before: OpenTab | null) => {
    tabSort.setOrder(g.key, moveInOrder(g.tabs, tab, before));
    tabSort.setSort(g.key, "manual");
  };
  const reorderRef = useRef(reorderTab);
  reorderRef.current = reorderTab;
  const rows = useMemo(() => visibleRows(shown, collapsed, query), [shown, collapsed, query]);
  const targets = useMemo(
    () => computeMoveTargets(org.groups, org.knownTags),
    [org.groups, org.knownTags],
  );
  // Keyboard order: closed pinned pages, then open tabs, then Recently closed.
  const pagePins = usePagePins(org.authed);
  const groupNotes = useGroupNotes(org.authed);
  const { view, choose: chooseView } = useViewMode();
  const previews = useTabPreviews(org.tabs, view === "tiles");
  const savedByTag = useSavedByTag(
    org.groups.filter((g) => g.kind === "tag").map((g) => g.value),
    org.authed,
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const openByKey = useMemo(
    () => new Map(org.tabs.map((t) => [normalizeUrl(t.url) ?? t.url, t])),
    [org.tabs],
  );
  const pinnedRows = useMemo(
    () =>
      pagePins.pins.filter(
        (p) => !openByKey.has(p.key) && matchesQuery({ url: p.url, title: p.title }, query),
      ),
    [pagePins.pins, openByKey, query],
  );
  const off = pinnedRows.length;
  // "N in trail" per tag group — one list fetch per panel open, grouped by first tag.
  const [trailCounts, setTrailCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!org.authed) return;
    let live = true;
    void listTrail({ limit: 100 })
      .then((r) => live && setTrailCounts(countByFirstTag(r.items)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [org.authed]);
  const openTrail = async (group: TabGroup) => {
    const r = await listTrail({ tag: group.value, limit: 50 }).catch(() => null);
    if (!r || r.items.length === 0) return;
    if (r.items.length > 10 && !window.confirm(`Open ${r.items.length} pages from the trail?`))
      return;
    for (const item of r.items) await browser.tabs.create({ url: item.url, active: false });
  };
  const stale = staleTabs(org.tabs, new Set(pagePins.byKey.keys()), now);
  const resumeClosed = (key: string) => void org.resumeGroup(key, pinsForGroup(pagePins.pins, key));
  const trail = useTrail({ query, authed: org.authed });
  const closedRows = trail.active ? trail.rows : [];
  const total = off + rows.length + closedRows.length;
  const selectedPinId = selected >= 0 && selected < off ? pinnedRows[selected].pinId : null;
  const selectedTabId = selected >= off ? (rows[selected - off]?.id ?? null) : null;
  const openPin = (pin: { url: string }) => void browser.tabs.create({ url: pin.url });
  const togglePin = (t: OpenTab) =>
    pagePins.isPinned(t.url)
      ? void pagePins.unpin(t.url)
      : void pagePins.pin({
          url: t.url,
          title: t.customTitle || t.title,
          ...(t.note && { note: t.note }),
        });

  // One-click keyword ideas per tag group, from phrases its tabs share (local, no AI).
  const keywordIdeas = useMemo(() => {
    const ideas = new Map<string, string[]>();
    for (const g of org.groups) {
      if (g.kind !== "tag") continue;
      const others = org.groups.filter((o) => o.key !== g.key).flatMap((o) => o.tabs);
      const s = suggestKeywords(g.tabs, others, org.keywords[g.value] ?? []);
      if (s.length) ideas.set(g.key, s);
    }
    return ideas;
  }, [org.groups, org.keywords]);
  const selectedTrailId =
    selected >= off + rows.length ? (closedRows[selected - off - rows.length]?.id ?? null) : null;

  // A new query highlights the top match; clearing it clears the highlight.
  useEffect(() => {
    setSelected(query.trim() ? 0 : -1);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, [selectedTabId, selectedTrailId]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => moveSelection(i, e.key === "ArrowDown" ? 1 : -1, total));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pinRow = selected >= 0 && selected < off ? pinnedRows[selected] : undefined;
      const closed =
        selected >= off + rows.length ? closedRows[selected - off - rows.length] : undefined;
      const tab = pinRow || closed ? null : rowToActivate(rows, selected - off);
      if (pinRow) openPin(pinRow);
      else if (tab) void org.activate(tab);
      else if (closed ?? closedRows[0]) void trail.reopen(closed ?? closedRows[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else {
        searchRef.current?.blur(); // hand off to single-key shortcuts
        if (selected < 0 && total) setSelected(0);
      }
    }
  }

  // Single-key shortcuts anywhere in the panel (not while typing in a field).
  const latest = useRef({
    rows,
    selected,
    shown,
    org,
    closedRows,
    trail,
    pinnedRows,
    off,
    pagePins,
    stale,
    togglePin,
    openPin,
  });
  latest.current = {
    rows,
    selected,
    shown,
    org,
    closedRows,
    trail,
    pinnedRows,
    off,
    pagePins,
    stale,
    togglePin,
    openPin,
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (isTypingTarget(e.target)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      const {
        rows,
        selected,
        shown,
        org,
        closedRows,
        trail,
        pinnedRows,
        off,
        pagePins,
        stale,
        togglePin,
        openPin,
      } = latest.current;
      const pinRow = selected >= 0 && selected < off ? pinnedRows[selected] : undefined;
      const tab = selected >= off ? (rows[selected - off] ?? null) : null;
      // A selected "Recently closed" row: ↵ reopens, x removes, s saves to clips.
      const closed = tab || pinRow ? undefined : closedRows[selected - off - rows.length];
      const group = tab ? shown.find((g) => g.tabs.some((t) => t.id === tab.id)) : undefined;
      e.preventDefault();
      switch (action) {
        case "focusSearch":
          searchRef.current?.focus();
          break;
        case "next":
        case "prev":
          setSelected((i) =>
            moveSelection(i, action === "next" ? 1 : -1, off + rows.length + closedRows.length),
          );
          break;
        case "pinTab":
          if (pinRow) void pagePins.unpin(pinRow.url);
          else if (tab && "windowId" in tab) togglePin(tab);
          break;
        case "open":
          if (pinRow) {
            openPin(pinRow);
            break;
          }
          if (tab) void org.activate(tab);
          else if (closed) void trail.reopen(closed);
          break;
        case "closeTab":
          if (tab) void org.closeTabs([tab.id]);
          else if (closed) void trail.remove(closed);
          break;
        case "stowTab":
          if (tab && org.authed) void org.stowTabs([tab]);
          else if (closed) void trail.promote(closed);
          break;
        case "moveTabUp":
        case "moveTabDown":
          if (tab && group) {
            const i = group.tabs.findIndex((t) => t.id === tab.id);
            const before = action === "moveTabUp" ? group.tabs[i - 1] : (group.tabs[i + 2] ?? null);
            if (action === "moveTabUp" && i <= 0) break;
            if (action === "moveTabDown" && i >= group.tabs.length - 1) break;
            reorderRef.current(group, tab, before ?? null);
            // The selection travels with the tab you moved.
            setSelected((sel) => sel + (action === "moveTabUp" ? -1 : 1));
          }
          break;
        case "moveTab":
          if (tab) setMoveRequest((r) => ({ tabId: tab.id, n: (r?.n ?? 0) + 1 }));
          break;
        case "mergeGroup":
          if (group && group.kind !== "done") {
            setMergeRequest((r) => ({ key: group.key, n: (r?.n ?? 0) + 1 }));
          }
          break;
        case "stowStale":
          if (org.authed && stale.length > 0) void org.stowTabs(stale);
          break;
        case "toggleView":
          chooseView(viewRef.current === "tiles" ? "list" : "tiles");
          break;
        case "noteGroup":
          if (group?.kind === "tag")
            setNoteRequest((r) => ({ key: group.key, n: (r?.n ?? 0) + 1 }));
          break;
        case "closeGroupKeep":
          if (group && group.kind !== "done") void org.closeGroup(group);
          break;
        case "renameTab":
        case "noteTab":
          if (tab && "windowId" in tab) {
            const kind = action === "renameTab" ? "rename" : "note";
            setMetaRequest((r) => ({ tabId: tab.id, kind, n: (r?.n ?? 0) + 1 }));
          }
          break;
        case "editGroup":
          if (group?.kind === "tag")
            setEditRequest((r) => ({ key: group.key, n: (r?.n ?? 0) + 1 }));
          break;
        case "acceptGroup":
          if (group?.kind === "proposed") void org.saveAsTag(group.value);
          break;
        case "closeGroup":
          if (group) void org.closeTabs(group.tabs.map((t) => t.id));
          break;
        case "stowGroup":
          if (group && group.kind !== "done" && org.authed) void org.stowTabs(group.tabs);
          break;
        case "closeDuplicates":
          void org.closeTabs(duplicateIdsToClose(org.tabs));
          break;
        case "help":
          setHelpOpen((o) => !o);
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  // Keep the selection on a real row after tabs close.
  useEffect(() => {
    if (selected >= total) setSelected(total - 1);
  }, [total, selected]);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${org.tabs.length} open tabs${trail.active ? " and closed ones" : ""}${showLabels ? "  ( / )" : ""}`}
        aria-label="Search open tabs"
        className="w-full rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) shadow-brutal-sm outline-none focus:shadow-brutal-pressed"
      />
      <div role="group" aria-label="View" className="-mt-1.5 flex items-center gap-1 self-end">
        {(["list", "tiles"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => chooseView(v)}
            className={`cursor-pointer rounded-md border-0 px-2 py-0.5 text-[11px] font-bold ${
              view === v
                ? "bg-neon-100 text-(--color-text) dark:bg-neon-900/50"
                : "bg-transparent text-(--color-text-faint) hover:text-(--color-text)"
            }`}
          >
            {v === "list" ? "List" : "Tiles"}
          </button>
        ))}
        {showLabels && <Kbd>{labelFor("toggleView")}</Kbd>}
      </div>

      <PinnedGroup
        pins={pagePins.pins}
        openByKey={openByKey}
        selectedPinId={selectedPinId}
        showLabels={showLabels}
        onOpen={openPin}
        onUnpin={(pin) => void pagePins.unpin(pin.url)}
      />
      {pagePins.undo && (
        <p className="m-0 flex items-center gap-2 rounded-lg bg-neon-100/70 px-2.5 py-1.5 text-[11px] text-(--color-text) dark:bg-neon-900/30">
          <span className="min-w-0 flex-1 truncate">{pagePins.undo.text}</span>
          <button
            type="button"
            onClick={() => void pagePins.undo?.run()}
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text) underline"
          >
            Undo
          </button>
        </p>
      )}
      {pagePins.error && <p className="m-0 text-[11px] text-red-600">{pagePins.error}</p>}
      {groupNotes.error && <p className="m-0 text-[11px] text-red-600">{groupNotes.error}</p>}

      {org.authed && stale.length > 0 && (
        <button
          type="button"
          onClick={() => void org.stowTabs(stale)}
          title="Save tabs you haven't touched in 3+ days to your library and close them"
          className="flex cursor-pointer items-center gap-1 self-start rounded-md border-2 border-(--color-border-hard) bg-(--color-surface) px-2 py-0.5 text-[11px] font-bold text-(--color-text) hover:bg-(--color-surface-raised)"
        >
          Stow stale ({stale.length}){showLabels && <Kbd>{labelFor("stowStale")}</Kbd>}
        </button>
      )}

      <DuplicatesPanel
        showLabels={showLabels}
        tabs={org.tabs}
        onCloseTabs={(ids) => void org.closeTabs(ids)}
      />

      {org.authed && !org.contentGranted && (
        <div className="rounded-lg border-2 border-dashed border-(--color-border-hard) p-2.5">
          <button
            type="button"
            onClick={() => void org.requestContent()}
            className="cursor-pointer rounded-lg border-2 border-(--color-border-hard) bg-neon-100 px-2.5 py-1 text-xs font-bold text-neon-700 shadow-brutal-sm hover:shadow-brutal-pressed press-down dark:bg-neon-900/50 dark:text-neon-400"
          >
            Organize by page content
          </button>
          <p className="m-0 mt-1.5 text-[11px] leading-snug text-(--color-text-faint)">
            Sends each tab’s title, URL and up to 2,000 characters of its page text to Cliphy to
            group your tabs. Nothing is stored. Pages with password fields are never read.
          </p>
        </div>
      )}

      {org.authed === false && (
        <p className="m-0 text-xs text-(--color-text-faint)">
          Grouped by site. Sign in to organize by topic.
        </p>
      )}

      {org.status === "error" && (
        <p className="m-0 flex items-center gap-2 text-xs text-red-600">
          Couldn’t organize.
          <button
            type="button"
            onClick={() => void org.retry()}
            className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-red-600 underline"
          >
            Retry
          </button>
        </p>
      )}
      {org.status === "organizing" && (
        <p className="m-0 text-[11px] text-(--color-text-faint)">Organizing…</p>
      )}

      {lastMerge && (
        <p className="m-0 flex items-center gap-2 rounded-lg bg-neon-100/70 px-2.5 py-1.5 text-[11px] text-(--color-text) dark:bg-neon-900/30">
          <span className="min-w-0 flex-1 truncate">{lastMerge.text}</span>
          <button
            type="button"
            onClick={() => {
              const { undo } = lastMerge;
              setLastMerge(null);
              void undo();
            }}
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text) underline"
          >
            Undo
          </button>
        </p>
      )}

      {org.hasManualOrder && (
        <button
          type="button"
          onClick={org.resetOrder}
          className="-mb-2 self-end cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-(--color-text-faint) hover:text-(--color-text)"
        >
          Reset order
        </button>
      )}

      <div ref={listRef}>
        {shown.length === 0 ? (
          <p className="text-xs text-(--color-text-faint)">
            {query ? "No tabs match." : "No open web tabs."}
          </p>
        ) : (
          shown.map((group) => (
            <TabGroupSection
              key={group.key}
              group={group}
              collapsed={draggingGroup || (!query.trim() && collapsed.has(group.key))}
              onDragStateChange={setDraggingGroup}
              keywordSuggestions={group.kind === "tag" ? keywordIdeas.get(group.key) : undefined}
              reason={group.kind === "proposed" ? org.proposalReasons?.[group.value] : undefined}
              onToggle={() => toggle(group.key)}
              selectedTabId={selectedTabId}
              moveTargets={targets}
              canStow={!!org.authed}
              trackingSince={org.trackingSince}
              now={now}
              hints={group.kind === "tag" ? org.hints[group.value] : undefined}
              keywords={
                group.kind === "tag"
                  ? org.keywords[group.value]
                  : group.kind === "proposed"
                    ? org.proposalKeywords[group.value]
                    : undefined
              }
              onActivate={(t) => void org.activate(t)}
              onCloseTabs={(list) => void org.closeTabs(list.map((t) => t.id))}
              onStowTabs={org.stowTabs}
              onMove={(t, key) => void org.moveTo(t, key)}
              onSaveHints={org.saveHints}
              onSaveAsTag={org.saveAsTag}
              onDismiss={(name) => void org.dismissProposal(name)}
              onReorder={group.kind === "done" ? undefined : org.reorder}
              onNudge={group.kind === "done" ? undefined : org.nudge}
              showLabels={showLabels}
              editNonce={editRequest?.key === group.key ? editRequest.n : undefined}
              moveRequest={moveRequest}
              metaRequest={metaRequest}
              onSetMeta={org.setMeta}
              pinnedKeys={new Set(pagePins.byKey.keys())}
              onTogglePin={togglePin}
              counts={
                group.kind === "tag"
                  ? groupCounts(group, pagePins.pins, trailCounts.get(group.value) ?? 0)
                  : undefined
              }
              onCloseGroupKeep={(g) => void org.closeGroup(g)}
              onOpenTrail={(g) => void openTrail(g)}
              onMergeInto={(from, into) => void mergeInto(from, into)}
              mergeTargets={org.groups.filter((g) => g.key !== group.key && g.kind !== "done")}
              mergeNonce={mergeRequest?.key === group.key ? mergeRequest.n : undefined}
              note={group.kind === "tag" ? groupNotes.notes[group.value] : undefined}
              onSaveNote={(tag, text) => void groupNotes.save(tag, text)}
              noteNonce={noteRequest?.key === group.key ? noteRequest.n : undefined}
              view={view}
              previews={previews}
              sort={tabSort.sortFor(group.key)}
              onSetSort={(s) => tabSort.setSort(group.key, s)}
              onReorderTab={(t, before) => reorderTab(group, t, before)}
              saved={group.kind === "tag" ? savedByTag[group.value] : undefined}
              saveStatus={org.saveStatus[group.key]}
              onSaveNow={group.kind === "tag" ? () => void org.saveGroupNow(group) : undefined}
              savedUrls={org.savedPages[group.key]}
              onOpenSummary={(id) => void openWebApp(WEB_ROUTES.SUMMARY(id))}
            />
          ))
        )}

        <ClosedGroups
          groups={org.closedGroups}
          now={now}
          selectedKey={null}
          showLabels={showLabels}
          onResume={resumeClosed}
          onForget={(key) => void org.forgetGroup(key)}
        />

        <TrailSection
          trail={trail}
          selectedId={selectedTrailId}
          now={now}
          showLabels={showLabels}
          groupTargets={targets}
          onReopenInto={(item, key) =>
            void org.placeUrl(item.url, key).then(() => trail.reopen(item))
          }
        />
      </div>

      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="self-start cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-(--color-text-faint) hover:text-(--color-text)"
      >
        Keyboard shortcuts <Kbd>?</Kbd>
      </button>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
