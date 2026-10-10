import { useEffect, useState } from "react";
import { PANEL_SHORTCUTS, keyLabel } from "../../lib/tabs/shortcuts";
import { Kbd } from "./Kbd";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘⇧" : "Ctrl+Shift+";

interface ShortcutHelpProps {
  onClose: () => void;
}

interface Command {
  name: string;
  description?: string;
  shortcut?: string;
}

/** `?` cheat sheet: panel keys, the browser-wide commands, and the labels toggle. */
export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  // The real global keys (users can remap them in chrome://extensions/shortcuts).
  const [commands, setCommands] = useState<Command[]>([]);
  useEffect(() => {
    void browser.commands
      ?.getAll()
      .then((all: Command[]) => setCommands(all.filter((c) => c.name !== "_execute_action")))
      .catch(() => {});
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) p-3 shadow-brutal-sm"
      >
        <header className="mb-2 flex items-center justify-between">
          <h2 className="m-0 text-sm font-black text-(--color-text)">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer border-0 bg-transparent p-0 text-sm text-(--color-text-faint)"
          >
            ✕
          </button>
        </header>

        <h3 className="m-0 mb-1 text-[10px] font-bold uppercase text-(--color-text-faint)">
          Anywhere in the browser
        </h3>
        <ul className="m-0 mb-3 list-none p-0">
          {(commands.length
            ? commands
            : [
                { name: "open-tabs-view", description: "Open Cliphy Tabs", shortcut: `${MOD}K` },
                { name: "save-page", description: "Save this page to Cliphy", shortcut: `${MOD}S` },
              ]
          ).map((c) => (
            <li key={c.name} className="flex justify-between py-0.5 text-xs text-(--color-text)">
              <span>{c.description ?? c.name}</span>
              <Kbd>{c.shortcut || "not set"}</Kbd>
            </li>
          ))}
        </ul>

        <h3 className="m-0 mb-1 text-[10px] font-bold uppercase text-(--color-text-faint)">
          In this panel
        </h3>
        <ul className="m-0 mb-1 list-none p-0">
          {PANEL_SHORTCUTS.map((s) => (
            <li key={s.action} className="flex justify-between py-0.5 text-xs text-(--color-text)">
              <span>{s.label}</span>
              <span>
                {s.keys.map((k) => (
                  <Kbd key={k}>{keyLabel(k)}</Kbd>
                ))}
              </span>
            </li>
          ))}
          <li className="flex justify-between py-0.5 text-xs text-(--color-text)">
            <span>Move group up / down</span>
            <span>
              <Kbd>⌥↑</Kbd>
              <Kbd>⌥↓</Kbd>
            </span>
          </li>
        </ul>

        <p className="m-0 mt-2 text-[11px] text-(--color-text-faint)">
          Hold <Kbd className="ml-0">{IS_MAC ? "⌘" : "Ctrl"}</Kbd> to see shortcut labels on
          buttons.
        </p>
      </div>
    </div>
  );
}
