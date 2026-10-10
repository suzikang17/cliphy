import { useEffect, useRef, useState } from "react";
import { Kbd } from "./Kbd";
import { labelFor } from "../../lib/tabs/shortcuts";
import type { GroupKey, TabGroup } from "../../lib/tabs/organize";
import type { OpenTab } from "../../lib/tabs/types";
import { normalizeKeywords } from "@cliphy/shared";
import { TabRow } from "./TabRow";
import { nestDuplicates, normalizeUrl } from "../../lib/tabs/dedupe";
import { dropZone, type DropZone } from "../../lib/tabs/merge";
import { getDraggedTab, TAB_DRAG_TYPE } from "../../lib/tabs/dragTab";

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
  onSaveAsTag: (name: string, rename?: string) => Promise<void>;
  /** Why a suggested group belongs together (from Claude). */
  reason?: string;
  onDismiss: (name: string) => void;
  /** Drag-and-drop reorder; undefined for groups that can't move (Probably done). */
  onReorder?: (from: GroupKey, target: GroupKey, position: "before" | "after") => void;
  onNudge?: (key: GroupKey, dir: -1 | 1) => void;
  /** Locally computed keyword ideas for this tag group; one click adds one. */
  keywordSuggestions?: string[];
  /** Merge group `from` into `into` (drag onto the middle of a header, or ⋯ → Merge into…). */
  onMergeInto?: (from: GroupKey, into: GroupKey) => void;
  /** Groups this one can be merged into (for the ⋯ menu). */
  mergeTargets?: TabGroup[];
  /** Changes when ⇧M asks this group to open its Merge picker. */
  mergeNonce?: number;
  /** Tells the list a drag started/ended (it collapses groups while dragging). */
  onDragStateChange?: (dragging: boolean) => void;
  showLabels?: boolean;
  /** Changes when the `e` shortcut asks this group to open its editor. */
  editNonce?: number;
  /** Forwarded to rows: the `m` shortcut asks a row to open its Move picker. */
  moveRequest?: { tabId: number; n: number } | null;
  /** Forwarded to rows: the `r` / `n` shortcuts ask a row to rename / add a note. */
  metaRequest?: { tabId: number; kind: "rename" | "note"; n: number } | null;
  onSetMeta?: (tab: OpenTab, patch: { title?: string; note?: string }) => Promise<void>;
  /** Normalized page keys that are pinned. */
  pinnedKeys?: Set<string>;
  /** "6 open · 2 pinned · 14 in trail" for tag groups. */
  counts?: { open: number; pinned: number; trail: number };
  /** Close the whole group, keeping it to resume later (⇧C). */
  onCloseGroupKeep?: (group: TabGroup) => void;
  /** Open the group's trail pages. */
  onOpenTrail?: (group: TabGroup) => void;
  onTogglePin?: (tab: OpenTab) => void;
}

/** dataTransfer type for a dragged group, so tab/text drags are ignored. */
const DRAG_TYPE = "application/x-cliphy-group";
/**
 * The group being dragged. dataTransfer can't be read during dragover, so the
 * key lives here to suppress the drop line on the dragged group itself.
 */
let draggingKey: GroupKey | null = null;

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
  onDragStateChange,
  onMergeInto,
  mergeTargets = [],
  mergeNonce,
  keywordSuggestions = [],
  reason,
  showLabels = false,
  editNonce,
  moveRequest = null,
  metaRequest = null,
  onSetMeta,
  pinnedKeys,
  onTogglePin,
  counts,
  onCloseGroupKeep,
  onOpenTrail,
}: TabGroupSectionProps) {
  const [dropAt, setDropAt] = useState<DropZone | null>(null);
  /** A tab row is being dragged over this group (drop = move it here). */
  const [tabDrop, setTabDrop] = useState(false);
  const [mergePicking, setMergePicking] = useState(false);
  // Naming a suggested group before saving it as a tag.
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  // True between dragstart and dragend. The fade is applied a frame late (so the
  // drag image is captured un-faded); if the drag already ended by then, skip it.
  const dragActive = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const movable = !!onReorder;

  function openEditor() {
    setDraft(hints ?? "");
    setKwDraft(keywords);
    setKwInput("");
    setEditingHints(true);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (mergeNonce !== undefined && onMergeInto && !isDone) setMergePicking(true);
  }, [mergeNonce]);
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

  const revealActions = menuOpen || showLabels || group.tabs.some((t) => t.id === selectedTabId);

  async function stowAll() {
    const n = await onStowTabs(group.tabs);
    setNote(n === group.tabs.length ? `Stowed ${n}` : `Stowed ${n} of ${group.tabs.length}`);
  }

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
      ref={sectionRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TAB_DRAG_TYPE)) {
          const d = getDraggedTab();
          if (!d || d.fromKey === group.key || !moveTargets.includes(group.key)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setTabDrop(true);
          return;
        }
        if (!movable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (draggingKey === group.key) {
          setDropAt(null); // dropping onto itself changes nothing
          return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        // Middle half merges into this group; top/bottom edges reorder.
        const canMerge = !!onMergeInto && !isDone && draggingKey !== "done";
        setDropAt(dropZone(e.clientY, r.top, r.height, canMerge));
      }}
      onDragLeave={(e) => {
        // Moving between child elements fires dragleave too — only clear on a real exit.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropAt(null);
          setTabDrop(false);
        }
      }}
      onDrop={(e) => {
        if (tabDrop) {
          setTabDrop(false);
          const d = getDraggedTab();
          if (d && d.fromKey !== group.key) {
            e.preventDefault();
            onMove(d.tab, group.key);
          }
          return;
        }
        const from = e.dataTransfer.getData(DRAG_TYPE);
        const at = dropAt;
        setDropAt(null);
        if (movable && from && at) {
          e.preventDefault();
          if (at === "merge") onMergeInto?.(from as GroupKey, group.key);
          else onReorder?.(from as GroupKey, group.key, at);
        }
      }}
      className={`group/section relative mb-3 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) shadow-brutal-sm transition-opacity ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {(dropAt === "before" || dropAt === "after") && <DropLine at={dropAt} />}
      {tabDrop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-md ring-4 ring-neon-500"
        >
          <span className="-mt-3 rounded-full border-2 border-(--color-border-hard) bg-neon-400 px-2 text-[10px] font-black uppercase leading-[18px] text-neon-900">
            Move to {group.label}
          </span>
        </div>
      )}
      {dropAt === "merge" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-md ring-4 ring-neon-500"
        >
          <span className="-mt-3 rounded-full border-2 border-(--color-border-hard) bg-neon-400 px-2 text-[10px] font-black uppercase leading-[18px] text-neon-900">
            Merge into {group.label}
          </span>
        </div>
      )}
      <header
        ref={headerRef}
        draggable={movable}
        onDragStart={(e) => {
          if (!movable) return;
          e.dataTransfer.setData(DRAG_TYPE, group.key);
          e.dataTransfer.effectAllowed = "move";
          // Drag the whole header (name + count), not the tiny grip glyph.
          if (headerRef.current) e.dataTransfer.setDragImage(headerRef.current, 16, 14);
          draggingKey = group.key;
          dragActive.current = true;
          // Change nothing on the page during dragstart: Chromium aborts a drag
          // whose source moves in that event (the list collapsing made upward
          // drags lose the grabber). Fade + collapse one frame later instead.
          requestAnimationFrame(() => {
            if (!dragActive.current) return;
            setIsDragging(true);
            onDragStateChange?.(true);
          });
        }}
        onDragEnd={() => {
          dragActive.current = false;
          draggingKey = null;
          setIsDragging(false);
          setDropAt(null);
          onDragStateChange?.(false);
        }}
        className={`flex items-center gap-2 px-2.5 py-1.5 ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {movable && (
          <span
            title="Drag to reorder (or ⌥↑ / ⌥↓)"
            aria-hidden
            className="shrink-0 select-none text-xs text-(--color-text-faint)"
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
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 border-0 bg-transparent p-0 text-left"
        >
          <span className="text-[10px] text-(--color-text-faint)">{collapsed ? "▸" : "▾"}</span>
          {/* The name gets the full width and wraps — it's the most important thing here. */}
          <span className="min-w-0 break-words text-xs font-extrabold text-(--color-text)">
            {group.label}
          </span>
          <span className="shrink-0 text-[10px] font-bold text-(--color-text-faint)">
            {group.tabs.length}
          </span>
        </button>

        {/* Actions reveal on hover, when this group holds the selected row, while ⌘ is held,
            or while the menu is open — so the header stays quiet otherwise. */}
        <span
          className={`flex shrink-0 items-center gap-1 transition-opacity ${
            revealActions
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover/section:opacity-100"
          }`}
        >
          <IconButton
            label={`Close all ${group.tabs.length} tabs in ${group.label}`}
            onClick={() => onCloseTabs(group.tabs)}
            kbd={showLabels ? labelFor("closeGroup") : undefined}
          >
            ✕
          </IconButton>
          {canStow && !isDone && (
            <IconButton
              label={`Stow all ${group.tabs.length} tabs in ${group.label} (save to Cliphy, then close)`}
              disabled={busy}
              onClick={() => void run(stowAll)}
              kbd={showLabels ? labelFor("stowGroup") : undefined}
            >
              {busy ? "…" : "⤓"}
            </IconButton>
          )}
          <span className="relative">
            <IconButton
              label={`More actions for ${group.label}`}
              onClick={() => setMenuOpen((o) => !o)}
              expanded={menuOpen}
            >
              ⋯
            </IconButton>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-20 min-w-40 rounded-md border-2 border-(--color-border-hard) bg-(--color-surface) py-1 shadow-brutal-sm">
                {isTag && (
                  <MenuItem onClick={openEditor} kbd="e">
                    Keywords & hints
                  </MenuItem>
                )}
                {onCloseGroupKeep && !isDone && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      onCloseGroupKeep(group);
                    }}
                    kbd={labelFor("closeGroupKeep")}
                  >
                    Close group (keep)
                  </MenuItem>
                )}
                {onOpenTrail && isTag && (counts?.trail ?? 0) > 0 && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenTrail(group);
                    }}
                    kbd=""
                  >
                    Open {counts!.trail} from trail
                  </MenuItem>
                )}
                {onMergeInto && !isDone && mergeTargets.length > 0 && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setMergePicking(true);
                    }}
                    kbd={labelFor("mergeGroup")}
                  >
                    Merge into…
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onCloseTabs(group.tabs);
                  }}
                  kbd={labelFor("closeGroup")}
                >
                  Close all
                </MenuItem>
                {canStow && !isDone && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      void run(stowAll);
                    }}
                    kbd={labelFor("stowGroup")}
                  >
                    Stow all
                  </MenuItem>
                )}
              </div>
            )}
          </span>
        </span>
      </header>

      {counts && isTag && (
        <p className="m-0 px-2.5 pb-1 text-[10px] text-(--color-text-faint)">
          {counts.open} open · {counts.pinned} pinned · {counts.trail} in trail
        </p>
      )}

      {mergePicking && (
        <div className="mx-2.5 mb-2 flex items-center gap-2">
          <select
            autoFocus
            aria-label={`Merge ${group.label} into`}
            defaultValue=""
            onBlur={() => setMergePicking(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMergePicking(false);
            }}
            onChange={(e) => {
              setMergePicking(false);
              if (e.target.value) onMergeInto?.(group.key, e.target.value);
            }}
            className="h-6 min-w-0 flex-1 rounded border border-(--color-border-hard) bg-(--color-surface) text-[11px] text-(--color-text)"
          >
            <option value="" disabled>
              Merge {group.label} into…
            </option>
            {mergeTargets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {isProposed && (
        <div className="mx-2.5 mb-2 rounded-md bg-neon-100/60 px-2 py-1.5 dark:bg-neon-900/25">
          {naming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await onSaveAsTag(group.value, nameDraft);
                  setNaming(false);
                });
              }}
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setNaming(false);
                  }
                }}
                maxLength={30}
                aria-label="Tag name"
                placeholder="e.g. freelance:lotus-bech"
                className="h-6 min-w-0 flex-1 rounded border border-(--color-border-hard) bg-(--color-surface) px-1.5 text-[11px] text-(--color-text) outline-none"
              />
              <button
                type="submit"
                disabled={busy || !nameDraft.trim()}
                className="flex h-6 shrink-0 cursor-pointer items-center rounded-md border-0 bg-neon-600 px-2 text-[11px] font-bold text-white hover:bg-neon-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setNaming(false)}
                className="flex h-6 shrink-0 cursor-pointer items-center rounded-md border-0 bg-transparent px-1.5 text-[11px] font-semibold text-(--color-text-faint) hover:text-(--color-text)"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-neon-700 dark:text-neon-400">
                ✨ Suggested group
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNameDraft(group.value);
                  setNaming(true);
                }}
                title="Keep this as one of your tags (you can rename it first)"
                className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-neon-600 px-2 text-[11px] font-bold text-white hover:bg-neon-700 disabled:opacity-50"
              >
                ＋ Save as tag
                {showLabels && (
                  <Kbd className="ml-0.5 border-white/40 bg-transparent text-white">a</Kbd>
                )}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(group.value)}
                aria-label={`Dismiss suggested group ${group.label}`}
                className="flex h-6 shrink-0 cursor-pointer items-center rounded-md border-0 bg-transparent px-1.5 text-[11px] font-semibold text-(--color-text-faint) hover:text-(--color-text)"
              >
                Dismiss
              </button>
            </div>
          )}
          {reason && (
            <p className="m-0 mt-1 text-[11px] leading-snug text-(--color-text)">
              <span className="text-(--color-text-faint)">Why: </span>
              {reason}
            </p>
          )}
        </div>
      )}

      {(isProposed || (isTag && !editingHints)) &&
        (keywords.length > 0 || (isTag && keywordSuggestions.length > 0)) && (
          <p className="m-0 flex flex-wrap items-center gap-1 px-2.5 pb-1.5 text-[10px] text-(--color-text-faint)">
            {keywords.length > 0 && <span>{isProposed ? "Will match:" : "Matches:"}</span>}
            {keywords.map((k) => (
              <span
                key={k}
                className="rounded border border-(--color-border-soft) px-1 font-semibold text-(--color-text)"
              >
                {k}
              </span>
            ))}
            {isTag &&
              keywordSuggestions.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => onSaveHints(group.value, hints ?? "", [...keywords, k]))
                  }
                  title={`Add "${k}" as a keyword — tabs containing it will always land here`}
                  className="cursor-pointer rounded border border-dashed border-neon-500 bg-transparent px-1 text-[10px] font-semibold text-neon-700 hover:bg-neon-100 disabled:opacity-50 dark:text-neon-400 dark:hover:bg-neon-900/30"
                >
                  ＋ {k}
                </button>
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
          {nestDuplicates(group.tabs).flatMap(({ parent, children }) =>
            [parent, ...children].map((tab, i) => (
              <TabRow
                key={tab.id}
                tab={tab}
                selected={tab.id === selectedTabId}
                dimmed={isDone}
                nested={i > 0}
                dupCount={i === 0 ? children.length : 0}
                onCloseDupes={i === 0 ? () => onCloseTabs(children) : undefined}
                trackingSince={trackingSince}
                now={now}
                showLabels={showLabels}
                moveNonce={moveRequest?.tabId === tab.id ? moveRequest.n : undefined}
                renameNonce={
                  metaRequest?.tabId === tab.id && metaRequest.kind === "rename"
                    ? metaRequest.n
                    : undefined
                }
                noteNonce={
                  metaRequest?.tabId === tab.id && metaRequest.kind === "note"
                    ? metaRequest.n
                    : undefined
                }
                onSetMeta={onSetMeta}
                pinned={!!pinnedKeys?.has(normalizeUrl(tab.url) ?? tab.url)}
                onTogglePin={onTogglePin}
                groupKey={group.key}
                moveTargets={moveTargets}
                onActivate={onActivate}
                onClose={(t) => onCloseTabs([t])}
                onMove={onMove}
              />
            )),
          )}
        </ul>
      )}
    </section>
  );
}

/** Bold insertion line between groups while dragging. */
function DropLine({ at }: { at: "before" | "after" }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute -left-1 -right-1 z-10 flex items-center ${
        at === "before" ? "-top-[9px]" : "-bottom-[9px]"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-(--color-border-hard) bg-neon-400" />
      <span className="h-[3px] flex-1 bg-neon-500" />
      <span className="mx-1 shrink-0 rounded-full border-2 border-(--color-border-hard) bg-neon-400 px-1.5 text-[9px] font-black uppercase leading-[14px] text-neon-900">
        Move here
      </span>
      <span className="h-[3px] w-4 shrink-0 bg-neon-500" />
    </div>
  );
}

const iconBtn =
  "flex h-6 min-w-6 cursor-pointer items-center justify-center gap-0.5 rounded border-0 bg-transparent px-1 text-xs font-bold text-(--color-text-faint) hover:bg-neon-100 hover:text-(--color-text) disabled:opacity-50 dark:hover:bg-neon-900/30";

function IconButton({
  label,
  onClick,
  disabled,
  expanded,
  kbd,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  kbd?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className={iconBtn}
    >
      {children}
      {kbd && <Kbd className="ml-0.5">{kbd}</Kbd>}
    </button>
  );
}

function MenuItem({
  onClick,
  kbd,
  children,
}: {
  onClick: () => void;
  kbd?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap border-0 bg-transparent px-3 py-1 text-left text-xs text-(--color-text) hover:bg-neon-100 dark:hover:bg-neon-900/30"
    >
      {children}
      {kbd ? <Kbd>{kbd}</Kbd> : null}
    </button>
  );
}
