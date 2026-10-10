// Single-key shortcuts inside the Tabs view. Only fire when you're not typing
// in a field, and never with Cmd/Ctrl/Alt (so browser shortcuts and ⌥↑/⌥↓
// group reordering keep working). Labels are shown in the UI by default.

export type PanelAction =
  | "focusSearch"
  | "next"
  | "prev"
  | "open"
  | "closeTab"
  | "stowTab"
  | "moveTab"
  | "renameTab"
  | "noteTab"
  | "pinTab"
  | "editGroup"
  | "acceptGroup"
  | "closeGroup"
  | "stowGroup"
  | "closeDuplicates"
  | "mergeGroup"
  | "closeGroupKeep"
  | "noteGroup"
  | "toggleView"
  | "moveTabUp"
  | "moveTabDown"
  | "stowStale"
  | "help";

export interface PanelShortcut {
  action: PanelAction;
  /** Keys as KeyboardEvent.key values (case-sensitive: "X" = Shift+x). */
  keys: string[];
  /** Short label for chips and the cheat sheet. */
  label: string;
}

export const PANEL_SHORTCUTS: PanelShortcut[] = [
  { action: "focusSearch", keys: ["/"], label: "Search" },
  { action: "next", keys: ["j", "ArrowDown"], label: "Next tab" },
  { action: "prev", keys: ["k", "ArrowUp"], label: "Previous tab" },
  { action: "open", keys: ["Enter"], label: "Switch to tab" },
  { action: "closeTab", keys: ["x"], label: "Close tab" },
  { action: "stowTab", keys: ["s"], label: "Stow tab (save to Cliphy, close)" },
  { action: "moveTab", keys: ["m"], label: "Move tab to group…" },
  { action: "renameTab", keys: ["r"], label: "Rename tab" },
  { action: "noteTab", keys: ["n"], label: "Add a note to the tab" },
  { action: "noteGroup", keys: ["N"], label: "Add a note to the group" },
  { action: "toggleView", keys: ["v"], label: "Switch list / tiles" },
  { action: "moveTabUp", keys: ["K"], label: "Move tab up in its group" },
  { action: "moveTabDown", keys: ["J"], label: "Move tab down in its group" },
  { action: "pinTab", keys: ["p"], label: "Pin / unpin tab" },
  { action: "editGroup", keys: ["e"], label: "Edit group keywords & hints" },
  { action: "acceptGroup", keys: ["a"], label: "Save suggested group as tag" },
  { action: "closeGroup", keys: ["X"], label: "Close all in group" },
  { action: "stowGroup", keys: ["S"], label: "Stow all in group" },
  { action: "closeDuplicates", keys: ["D"], label: "Close duplicates" },
  { action: "mergeGroup", keys: ["M"], label: "Merge group into…" },
  { action: "closeGroupKeep", keys: ["C"], label: "Close group (keep it to resume later)" },
  { action: "help", keys: ["?"], label: "All shortcuts" },
  { action: "stowStale", keys: ["W"], label: "Stow stale tabs (untouched 3+ days)" },
];

const BY_KEY = new Map(PANEL_SHORTCUTS.flatMap((s) => s.keys.map((k) => [k, s.action] as const)));

/** Display form of a key for chips: "X" → "⇧X", "ArrowDown" → "↓". */
export function keyLabel(k: string): string {
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowUp") return "↑";
  if (k === "Enter") return "↵";
  if (k.length === 1 && k !== k.toLowerCase()) return `⇧${k}`;
  return k;
}

/** Primary key label for an action, e.g. labelFor("closeGroup") → "⇧X". */
export function labelFor(action: PanelAction): string {
  const s = PANEL_SHORTCUTS.find((x) => x.action === action);
  return s ? keyLabel(s.keys[0]) : "";
}

export function resolveShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): PanelAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return BY_KEY.get(e.key) ?? null;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.contentEditable === "true") return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** The modifier that reveals shortcut labels while held: ⌘ on Mac, Ctrl elsewhere. */
export const LABEL_MODIFIER: "Meta" | "Control" =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "Meta"
    : "Control";
