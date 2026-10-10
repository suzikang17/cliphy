import { useEffect, useMemo, useRef, useState } from "react";
import { moveTargets as computeMoveTargets } from "../../lib/tabs/organize";
import { filterGroups, moveSelection, rowToActivate, visibleRows } from "../../lib/tabs/search";
import { useTabOrganizer } from "../../lib/tabs/useTabOrganizer";
import { TabGroupSection } from "./TabGroupSection";
import { DuplicatesPanel } from "./DuplicatesPanel";

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
      setQuery("");
    }
  }

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
        placeholder={`Search ${org.tabs.length} open tabs`}
        aria-label="Search open tabs"
        className="w-full rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) shadow-brutal-sm outline-none focus:shadow-brutal-pressed"
      />

      <DuplicatesPanel
        tabs={org.tabs}
        onActivate={(t) => void org.activate(t)}
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
            />
          ))
        )}
      </div>
    </div>
  );
}
