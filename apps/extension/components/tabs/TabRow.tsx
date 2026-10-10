import { useEffect, useState } from "react";
import { Kbd } from "./Kbd";
import { faviconUrl } from "../pins/TileStrip";
import { groupLabel, type GroupKey } from "../../lib/tabs/organize";
import { hostOf, type OpenTab } from "../../lib/tabs/types";
import { tabTimesLabel, tabTimesTitle } from "../../lib/tabs/openedAt";
import { isStale } from "../../lib/tabs/stale";

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
  /** The page is pinned (shows 📌); onTogglePin pins/unpins. */
  pinned?: boolean;
  onTogglePin?: (tab: OpenTab) => void;
  /** Current group, excluded from the Move-to list. */
  groupKey: GroupKey;
  moveTargets: GroupKey[];
  onActivate: (tab: OpenTab) => void;
  onClose: (tab: OpenTab) => void;
  onMove: (tab: OpenTab, key: GroupKey) => void;
  /** Rename the page / set its note. */
  onSetMeta?: (tab: OpenTab, patch: { title?: string; note?: string }) => Promise<void>;
  /** Change when the `r` / `n` shortcuts ask this row to start renaming / noting. */
  renameNonce?: number;
  noteNonce?: number;
}

type Editing = "rename" | "note" | null;

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
  pinned = false,
  onTogglePin,
  groupKey,
  moveTargets,
  onActivate,
  onClose,
  onMove,
  onSetMeta,
  renameNonce,
  noteNonce,
}: TabRowProps) {
  const [moving, setMoving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const name = tab.customTitle || tab.title;

  function startEditing(kind: Exclude<Editing, null>) {
    if (!onSetMeta) return;
    setMenuOpen(false);
    setDraft(kind === "rename" ? name : (tab.note ?? ""));
    setEditing(kind);
  }
  async function saveEdit() {
    if (!onSetMeta || !editing) return;
    // Renaming back to the page's own title (or to nothing) clears the custom name.
    const value = draft.trim();
    await onSetMeta(
      tab,
      editing === "rename" ? { title: value === tab.title ? "" : value } : { note: value },
    );
    setEditing(null);
  }
  useEffect(() => {
    if (renameNonce !== undefined) startEditing("rename");
  }, [renameNonce]);
  useEffect(() => {
    if (noteNonce !== undefined) startEditing("note");
  }, [noteNonce]);
  const [iconBroken, setIconBroken] = useState(false);
  const targets = moveTargets.filter((k) => k !== groupKey);
  useEffect(() => {
    if (moveNonce !== undefined) setMoving(true);
  }, [moveNonce]);

  return (
    <li
      data-selected={selected || undefined}
      className={`group/row rounded-md px-1.5 py-1 ${
        tab.active ? "bg-neon-100/70 dark:bg-neon-900/30" : ""
      } ${selected ? "ring-2 ring-(--color-border-hard)" : ""} ${dimmed || nested ? "opacity-55" : ""} ${
        nested ? "ml-5 border-l-2 border-(--color-border-soft) pl-2" : ""
      }`}
    >
      <div className="flex items-center gap-2">
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
          title={[
            tab.customTitle ? `Page title: ${tab.title}` : "",
            tab.url,
            tabTimesTitle(tab.openedAt, tab.lastAccessed),
          ]
            .filter(Boolean)
            .join("\n")}
          className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
        >
          <span className="block truncate text-xs font-semibold text-(--color-text)">
            {pinned && (
              <span title="Pinned" aria-label="Pinned" className="mr-1">
                📌
              </span>
            )}
            {name}
          </span>
          <span className="block truncate text-[10px] text-(--color-text-faint)">
            {[
              hostOf(tab.url),
              tab.otherWindow ? "other window" : "",
              !tab.active && isStale(tab, now) ? "stale" : "",
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
          {tab.note && editing !== "note" && (
            <span className="mt-0.5 block truncate text-[10px] italic text-(--color-text)">
              📝 {tab.note}
            </span>
          )}
          {showLabels && selected && (
            <span className="mt-0.5 block text-[9px] text-(--color-text-faint)">
              <Kbd className="ml-0">↵</Kbd> open <Kbd>x</Kbd> close <Kbd>s</Kbd> stow <Kbd>m</Kbd>{" "}
              move <Kbd>r</Kbd> rename <Kbd>n</Kbd> note
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
              <span className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  title="More"
                  aria-label={`More actions for ${name}`}
                  aria-expanded={menuOpen}
                  className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-(--color-text)"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-5 z-20 min-w-36 rounded-md border-2 border-(--color-border-hard) bg-(--color-surface) py-1 shadow-brutal-sm">
                    <RowMenuItem
                      onClick={() => {
                        setMenuOpen(false);
                        setMoving(true);
                      }}
                      kbd="m"
                    >
                      Move to…
                    </RowMenuItem>
                    {onTogglePin && (
                      <RowMenuItem
                        onClick={() => {
                          setMenuOpen(false);
                          onTogglePin(tab);
                        }}
                        kbd="p"
                      >
                        {pinned ? "Unpin" : "Pin"}
                      </RowMenuItem>
                    )}
                    {onSetMeta && (
                      <>
                        <RowMenuItem onClick={() => startEditing("rename")} kbd="r">
                          Rename
                        </RowMenuItem>
                        <RowMenuItem onClick={() => startEditing("note")} kbd="n">
                          {tab.note ? "Edit note" : "Add note"}
                        </RowMenuItem>
                      </>
                    )}
                  </div>
                )}
              </span>
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
      </div>

      {editing && (
        <form
          className="mt-1 flex items-center gap-1.5 pl-6"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
            maxLength={editing === "rename" ? 200 : 500}
            aria-label={editing === "rename" ? `Name for ${tab.title}` : `Note for ${name}`}
            placeholder={editing === "rename" ? tab.title : "Quick note…"}
            className="h-6 min-w-0 flex-1 rounded border border-(--color-border-hard) bg-(--color-surface) px-1.5 text-[11px] text-(--color-text) outline-none"
          />
          <button
            type="submit"
            className="flex h-6 shrink-0 cursor-pointer items-center rounded-md border-0 bg-neon-600 px-2 text-[11px] font-bold text-white hover:bg-neon-700"
          >
            Save
          </button>
        </form>
      )}
    </li>
  );
}

function RowMenuItem({
  onClick,
  kbd,
  children,
}: {
  onClick: () => void;
  kbd: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap border-0 bg-transparent px-3 py-1 text-left text-xs text-(--color-text) hover:bg-neon-100 dark:hover:bg-neon-900/30"
    >
      {children}
      <Kbd>{kbd}</Kbd>
    </button>
  );
}
