import { useEffect, useState } from "react";
import { Kbd } from "./Kbd";
import { faviconUrl } from "../pins/TileStrip";
import { groupLabel, type GroupKey } from "../../lib/tabs/organize";
import { hostOf, type OpenTab } from "../../lib/tabs/types";
import { tabTimesLabel, tabTimesTitle } from "../../lib/tabs/openedAt";

interface TabRowProps {
  tab: OpenTab;
  selected: boolean;
  dimmed?: boolean;
  trackingSince: number | null;
  now: number;
  showLabels?: boolean;
  /** Changes when the `m` shortcut asks this row to open its Move picker. */
  moveNonce?: number;
  /** Parent of duplicate copies: how many extra copies are nested under it. */
  dupCount?: number;
  onCloseDupes?: () => void;
  /** A duplicate copy shown indented under its parent. */
  nested?: boolean;
  /** Current group, excluded from the Move-to list. */
  groupKey: GroupKey;
  moveTargets: GroupKey[];
  onActivate: (tab: OpenTab) => void;
  onClose: (tab: OpenTab) => void;
  onMove: (tab: OpenTab, key: GroupKey) => void;
}

export function TabRow({
  tab,
  selected,
  dimmed,
  trackingSince,
  now,
  showLabels = false,
  moveNonce,
  dupCount = 0,
  onCloseDupes,
  nested = false,
  groupKey,
  moveTargets,
  onActivate,
  onClose,
  onMove,
}: TabRowProps) {
  const [moving, setMoving] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  const targets = moveTargets.filter((k) => k !== groupKey);
  useEffect(() => {
    if (moveNonce !== undefined) setMoving(true);
  }, [moveNonce]);

  return (
    <li
      data-selected={selected || undefined}
      className={`group/row flex items-center gap-2 rounded-md px-1.5 py-1 ${
        tab.active ? "bg-neon-100/70 dark:bg-neon-900/30" : ""
      } ${selected ? "ring-2 ring-(--color-border-hard)" : ""} ${dimmed || nested ? "opacity-55" : ""} ${
        nested ? "ml-5 border-l-2 border-(--color-border-soft) pl-2" : ""
      }`}
    >
      {iconBroken ? (
        <span className="w-4 shrink-0" />
      ) : (
        <img
          src={tab.favIconUrl || faviconUrl(tab.url)}
          alt=""
          width={16}
          height={16}
          className="shrink-0"
          onError={() => setIconBroken(true)}
        />
      )}
      <button
        type="button"
        onClick={() => onActivate(tab)}
        title={[tab.url, tabTimesTitle(tab.openedAt, tab.lastAccessed)].filter(Boolean).join("\n")}
        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        <span className="block truncate text-xs font-semibold text-(--color-text)">
          {tab.title}
        </span>
        <span className="block truncate text-[10px] text-(--color-text-faint)">
          {[
            hostOf(tab.url),
            tab.otherWindow ? "other window" : "",
            tabTimesLabel({
              openedAt: tab.openedAt,
              trackingSince,
              lastAccessed: tab.lastAccessed,
              active: tab.active,
              now,
            }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {showLabels && selected && (
          <span className="mt-0.5 block text-[9px] text-(--color-text-faint)">
            <Kbd className="ml-0">↵</Kbd> open <Kbd>x</Kbd> close <Kbd>s</Kbd> stow <Kbd>m</Kbd>{" "}
            move
          </span>
        )}
      </button>

      {moving ? (
        <select
          autoFocus
          aria-label={`Move ${tab.title} to`}
          defaultValue=""
          onBlur={() => setMoving(false)}
          onChange={(e) => {
            if (e.target.value) onMove(tab, e.target.value);
            setMoving(false);
          }}
          className="max-w-[45%] shrink-0 rounded border border-(--color-border-hard) bg-(--color-surface) text-[11px] text-(--color-text)"
        >
          <option value="" disabled>
            Move to…
          </option>
          {targets.map((k) => (
            <option key={k} value={k}>
              {groupLabel(k)}
            </option>
          ))}
        </select>
      ) : (
        <>
          {dupCount > 0 && onCloseDupes && (
            <button
              type="button"
              onClick={onCloseDupes}
              title={`Close the ${dupCount} duplicate ${dupCount === 1 ? "copy" : "copies"} of this page`}
              className="shrink-0 cursor-pointer rounded border border-(--color-border-hard) bg-neon-100 px-1.5 text-[10px] font-bold text-neon-700 hover:shadow-brutal-sm dark:bg-neon-900/50 dark:text-neon-400"
            >
              ×{dupCount} close dupes
            </button>
          )}
          <span className="flex shrink-0 gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => setMoving(true)}
              title="Move to…"
              aria-label={`Move ${tab.title} to another group`}
              className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-(--color-text)"
            >
              ⋯
            </button>
            <button
              type="button"
              onClick={() => onClose(tab)}
              title="Close tab"
              aria-label={`Close ${tab.title}`}
              className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-red-600"
            >
              ✕
            </button>
          </span>
        </>
      )}
    </li>
  );
}
