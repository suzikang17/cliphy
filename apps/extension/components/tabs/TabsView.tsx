import { useEffect, useMemo, useRef, useState } from "react";
import { moveTargets as computeMoveTargets } from "../../lib/tabs/organize";
import { filterGroups, moveSelection, rowToActivate, visibleRows } from "../../lib/tabs/search";
import { useTabOrganizer } from "../../lib/tabs/useTabOrganizer";
import { TabGroupSection } from "./TabGroupSection";
import { DuplicatesPanel } from "./DuplicatesPanel";
import { ShortcutHelp } from "./ShortcutHelp";
import { Kbd } from "./Kbd";
import { duplicateIdsToClose } from "../../lib/tabs/dedupe";
import { isTypingTarget, LABEL_MODIFIER, resolveShortcut } from "../../lib/tabs/shortcuts";

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
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Shortcut labels show only while ⌘ (Ctrl on Windows) is held.
  const [showLabels, setShowLabels] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Keyboard requests to open a row's Move picker / a group's editor (nonce re-triggers).
  const [moveRequest, setMoveRequest] = useState<{ tabId: number; n: number } | null>(null);
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

  const shown = useMemo(() => filterGroups(org.groups, query), [org.groups, query]);
  const rows = useMemo(() => visibleRows(shown, collapsed, query), [shown, collapsed, query]);
  const targets = useMemo(
    () => computeMoveTargets(org.groups, org.knownTags),
    [org.groups, org.knownTags],
  );
  const selectedTabId = rows[selected]?.id ?? null;

  // A new query highlights the top match; clearing it clears the highlight.
  useEffect(() => {
    setSelected(query.trim() ? 0 : -1);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, [selectedTabId]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => moveSelection(i, e.key === "ArrowDown" ? 1 : -1, rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const tab = rowToActivate(rows, selected);
      if (tab) void org.activate(tab);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else {
        searchRef.current?.blur(); // hand off to single-key shortcuts
        if (selected < 0 && rows.length) setSelected(0);
      }
    }
  }

  // Single-key shortcuts anywhere in the panel (not while typing in a field).
  const latest = useRef({ rows, selected, shown, org });
  latest.current = { rows, selected, shown, org };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (isTypingTarget(e.target)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      const { rows, selected, shown, org } = latest.current;
      const tab = rows[selected] ?? null;
      const group = tab ? shown.find((g) => g.tabs.some((t) => t.id === tab.id)) : undefined;
      e.preventDefault();
      switch (action) {
        case "focusSearch":
          searchRef.current?.focus();
          break;
        case "next":
        case "prev":
          setSelected((i) => moveSelection(i, action === "next" ? 1 : -1, rows.length));
          break;
        case "open":
          if (tab) void org.activate(tab);
          break;
        case "closeTab":
          if (tab) void org.closeTabs([tab.id]);
          break;
        case "stowTab":
          if (tab && org.authed) void org.stowTabs([tab]);
          break;
        case "moveTab":
          if (tab) setMoveRequest((r) => ({ tabId: tab.id, n: (r?.n ?? 0) + 1 }));
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
    if (selected >= rows.length) setSelected(rows.length - 1);
  }, [rows.length, selected]);

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
        placeholder={`Search ${org.tabs.length} open tabs${showLabels ? "  ( / )" : ""}`}
        aria-label="Search open tabs"
        className="w-full rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) shadow-brutal-sm outline-none focus:shadow-brutal-pressed"
      />

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
              collapsed={!query.trim() && collapsed.has(group.key)}
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
            />
          ))
        )}
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
