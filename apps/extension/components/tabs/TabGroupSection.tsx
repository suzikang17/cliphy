import { useEffect, useState } from "react";
import { Kbd } from "./Kbd";
import { labelFor } from "../../lib/tabs/shortcuts";
import type { GroupKey, TabGroup } from "../../lib/tabs/organize";
import type { OpenTab } from "../../lib/tabs/types";
import { normalizeKeywords } from "@cliphy/shared";
import { TabRow } from "./TabRow";

export const HINTS_MAX = 500;

interface TabGroupSectionProps {
  group: TabGroup;
  collapsed: boolean;
  onToggle: () => void;
  selectedTabId: number | null;
  moveTargets: GroupKey[];
  canStow: boolean;
  trackingSince: number | null;
  now: number;
  hints?: string;
  /** Saved keywords for a tag group, or Claude's suggestions for a proposed one. */
  keywords?: string[];
  onActivate: (tab: OpenTab) => void;
  onCloseTabs: (tabs: OpenTab[]) => void;
  onStowTabs: (tabs: OpenTab[]) => Promise<number>;
  onMove: (tab: OpenTab, key: GroupKey) => void;
  onSaveHints: (tag: string, text: string, keywords?: string[]) => Promise<void>;
  onSaveAsTag: (name: string) => Promise<void>;
  onDismiss: (name: string) => void;
  /** Drag-and-drop reorder; undefined for groups that can't move (Probably done). */
  onReorder?: (from: GroupKey, target: GroupKey, position: "before" | "after") => void;
  onNudge?: (key: GroupKey, dir: -1 | 1) => void;
  showLabels?: boolean;
  /** Changes when the `e` shortcut asks this group to open its editor. */
  editNonce?: number;
  /** Forwarded to rows: the `m` shortcut asks a row to open its Move picker. */
  moveRequest?: { tabId: number; n: number } | null;
}

/** dataTransfer type for a dragged group, so tab/text drags are ignored. */
const DRAG_TYPE = "application/x-cliphy-group";

const linkBtn =
  "cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text-faint) hover:text-(--color-text) disabled:opacity-50";

export function TabGroupSection({
  group,
  collapsed,
  onToggle,
  selectedTabId,
  moveTargets,
  canStow,
  trackingSince,
  now,
  hints,
  keywords = [],
  onActivate,
  onCloseTabs,
  onStowTabs,
  onMove,
  onSaveHints,
  onSaveAsTag,
  onDismiss,
  onReorder,
  onNudge,
  showLabels = false,
  editNonce,
  moveRequest = null,
}: TabGroupSectionProps) {
  const [dropAt, setDropAt] = useState<"before" | "after" | null>(null);
  const movable = !!onReorder;

  function openEditor() {
    setDraft(hints ?? "");
    setKwDraft(keywords);
    setKwInput("");
    setEditingHints(true);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (editNonce !== undefined && isTag) openEditor();
  }, [editNonce]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingHints, setEditingHints] = useState(false);
  const [draft, setDraft] = useState("");
  const [kwDraft, setKwDraft] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");

  function addKeywordsFromInput() {
    const fresh = kwInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (fresh.length) setKwDraft((d) => normalizeKeywords([...d, ...fresh]));
    setKwInput("");
  }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const isTag = group.kind === "tag";
  const isProposed = group.kind === "proposed";
  const isDone = group.kind === "done";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch {
      setNote("Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      onDragOver={(e) => {
        if (!movable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropAt(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(DRAG_TYPE);
        const at = dropAt;
        setDropAt(null);
        if (movable && from && at) {
          e.preventDefault();
          onReorder?.(from as GroupKey, group.key, at);
        }
      }}
      className={`mb-3 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) shadow-brutal-sm ${
        dropAt === "before"
          ? "shadow-[0_-3px_0_0_var(--color-border-hard)]"
          : dropAt === "after"
            ? "shadow-[0_3px_0_0_var(--color-border-hard)]"
            : ""
      }`}
    >
      <header className="flex items-center gap-2 px-2.5 py-1.5">
        {movable && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, group.key);
              e.dataTransfer.effectAllowed = "move";
            }}
            title="Drag to reorder (or ⌥↑ / ⌥↓)"
            aria-hidden
            className="shrink-0 cursor-grab select-none text-xs text-(--color-text-faint) active:cursor-grabbing"
          >
            ⠿
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (!onNudge || !e.altKey) return;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onNudge(group.key, e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          aria-expanded={!collapsed}
          aria-keyshortcuts={movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        >
          <span className="text-[10px] text-(--color-text-faint)">{collapsed ? "▸" : "▾"}</span>
          <span className="truncate text-xs font-extrabold text-(--color-text)">{group.label}</span>
          <span className="shrink-0 text-[10px] font-bold text-(--color-text-faint)">
            {group.tabs.length}
          </span>
          {isProposed && (
            <span className="shrink-0 rounded border border-(--color-border-hard) bg-neon-100 px-1 text-[9px] font-bold uppercase text-neon-700 dark:bg-neon-900/50 dark:text-neon-400">
              Suggested
            </span>
          )}
        </button>

        <span className="flex shrink-0 items-center gap-2">
          {isProposed && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onSaveAsTag(group.value))}
                className={linkBtn}
                title="Keep this as one of your tags"
              >
                ＋ Save as tag
                {showLabels && <Kbd>a</Kbd>}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(group.value)}
                aria-label={`Dismiss suggested group ${group.label}`}
                className={linkBtn}
              >
                ✕
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onCloseTabs(group.tabs)}
            className={linkBtn}
            title="Close every tab in this group"
          >
            Close all
            {showLabels && <Kbd>{labelFor("closeGroup")}</Kbd>}
          </button>
          {canStow && !isDone && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const n = await onStowTabs(group.tabs);
                  setNote(
                    n === group.tabs.length ? `Stowed ${n}` : `Stowed ${n} of ${group.tabs.length}`,
                  );
                })
              }
              className={linkBtn}
              title="Save every tab to your inbox, then close it"
            >
              {busy ? "Stowing…" : "Stow all"}
              {showLabels && !busy && <Kbd>{labelFor("stowGroup")}</Kbd>}
            </button>
          )}
          {isTag && (
            <span className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={`More actions for ${group.label}`}
                aria-expanded={menuOpen}
                className={linkBtn}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-5 z-10 rounded-md border-2 border-(--color-border-hard) bg-(--color-surface) py-1 shadow-brutal-sm">
                  <button
                    type="button"
                    onClick={openEditor}
                    className="block w-full cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 py-1 text-left text-xs text-(--color-text) hover:bg-neon-100 dark:hover:bg-neon-900/30"
                  >
                    Keywords & hints
                    {showLabels && <Kbd>e</Kbd>}
                  </button>
                </div>
              )}
            </span>
          )}
        </span>
      </header>

      {(isProposed || (isTag && !editingHints)) && keywords.length > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-1 px-2.5 pb-1.5 text-[10px] text-(--color-text-faint)">
          <span>{isProposed ? "Will match:" : "Matches:"}</span>
          {keywords.map((k) => (
            <span
              key={k}
              className="rounded border border-(--color-border-soft) px-1 font-semibold text-(--color-text)"
            >
              {k}
            </span>
          ))}
        </p>
      )}

      {editingHints && (
        <div className="border-t border-(--color-border-soft) px-2.5 py-2">
          <label className="mb-1 block text-[10px] font-bold uppercase text-(--color-text-faint)">
            Keywords for {group.label}
          </label>
          <p className="m-0 mb-1 text-[10px] leading-snug text-(--color-text-faint)">
            Tabs whose address, title or text contain one of these always land here — instantly, no
            AI. Spaces and punctuation are ignored: “we curate life” matches wecuratelife.app.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-1 rounded border border-(--color-border-hard) bg-(--color-surface) p-1">
            {kwDraft.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded bg-neon-100 px-1.5 py-0.5 text-[11px] font-semibold text-neon-700 dark:bg-neon-900/50 dark:text-neon-400"
              >
                {k}
                <button
                  type="button"
                  onClick={() => setKwDraft((d) => d.filter((x) => x !== k))}
                  aria-label={`Remove keyword ${k}`}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-inherit opacity-70 hover:opacity-100"
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              autoFocus
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addKeywordsFromInput();
                } else if (e.key === "Backspace" && !kwInput && kwDraft.length) {
                  setKwDraft((d) => d.slice(0, -1));
                }
              }}
              onBlur={addKeywordsFromInput}
              placeholder={kwDraft.length ? "Add…" : "e.g. we curate life, lotus"}
              aria-label={`Add keyword for ${group.label}`}
              className="min-w-[6rem] flex-1 border-0 bg-transparent p-0.5 text-xs text-(--color-text) outline-none"
            />
          </div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-(--color-text-faint)">
            Hints (for AI matching)
          </label>
          <textarea
            value={draft}
            maxLength={HINTS_MAX}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Linear team ACME, Notion workspace “Acme Corp”, acme.com"
            className="w-full resize-y rounded border border-(--color-border-hard) bg-(--color-surface) p-1.5 text-xs text-(--color-text)"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-(--color-text-faint)">
              {draft.length}/{HINTS_MAX}
            </span>
            <span className="flex gap-3">
              <button type="button" onClick={() => setEditingHints(false)} className={linkBtn}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const pending = kwInput.trim()
                      ? normalizeKeywords([...kwDraft, ...kwInput.split(",")])
                      : kwDraft;
                    await onSaveHints(group.value, draft, pending);
                    setEditingHints(false);
                  })
                }
                className="cursor-pointer rounded-lg border-2 border-(--color-border-hard) bg-neon-100 px-2.5 py-1 text-xs font-bold text-neon-700 shadow-brutal-sm disabled:opacity-50 dark:bg-neon-900/50 dark:text-neon-400"
              >
                Save
              </button>
            </span>
          </div>
        </div>
      )}

      {note && <p className="m-0 px-2.5 pb-1 text-[11px] text-(--color-text-faint)">{note}</p>}

      {!collapsed && (
        <ul className="m-0 list-none border-t border-(--color-border-soft) p-1">
          {group.tabs.map((tab) => (
            <TabRow
              key={tab.id}
              tab={tab}
              selected={tab.id === selectedTabId}
              dimmed={isDone}
              trackingSince={trackingSince}
              now={now}
              showLabels={showLabels}
              moveNonce={moveRequest?.tabId === tab.id ? moveRequest.n : undefined}
              groupKey={group.key}
              moveTargets={moveTargets}
              onActivate={onActivate}
              onClose={(t) => onCloseTabs([t])}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
