import { useEffect, useMemo, useState } from "react";
import { duplicateIdsToClose, findDuplicates } from "../../lib/tabs/dedupe";
import {
  isDedupeEnabled,
  LAST_INTERCEPT_KEY,
  setDedupeEnabled,
  undoIntercept,
  type LastIntercept,
} from "../../lib/tabs/interceptDupes";
import type { OpenTab } from "../../lib/tabs/types";
import { Kbd } from "./Kbd";

const UNDO_WINDOW_MS = 60_000;

interface DuplicatesPanelProps {
  showLabels?: boolean;
  tabs: OpenTab[];
  onCloseTabs: (ids: number[]) => void;
}

/** Duplicate tabs at a glance: one-click cleanup, the auto-switch toggle, and Undo. */
export function DuplicatesPanel({ showLabels = false, tabs, onCloseTabs }: DuplicatesPanelProps) {
  const dupes = useMemo(() => findDuplicates(tabs), [tabs]);
  const extra = dupes.reduce((n, copies) => n + copies.length - 1, 0);
  const [enabled, setEnabled] = useState(true);
  const [last, setLast] = useState<LastIntercept | null>(null);

  useEffect(() => {
    void isDedupeEnabled().then(setEnabled);
    const read = () =>
      void browser.storage.session.get(LAST_INTERCEPT_KEY).then((r: Record<string, unknown>) => {
        const v = r?.[LAST_INTERCEPT_KEY] as LastIntercept | undefined;
        setLast(v && Date.now() - v.at < UNDO_WINDOW_MS ? v : null);
      });
    read();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && LAST_INTERCEPT_KEY in changes) read();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  function closeDuplicates() {
    onCloseTabs(duplicateIdsToClose(tabs));
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await setDedupeEnabled(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {last && (
        <p className="m-0 flex items-center gap-2 rounded-lg bg-neon-100/70 px-2.5 py-1.5 text-[11px] text-(--color-text) dark:bg-neon-900/30">
          <span className="min-w-0 flex-1 truncate">
            Closed a duplicate of <strong>{last.title}</strong>
          </span>
          <button
            type="button"
            onClick={() => void undoIntercept(last.url)}
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text) underline"
          >
            Undo
          </button>
        </p>
      )}

      {dupes.length > 0 && (
        <p className="m-0 flex items-center gap-2 text-[11px] text-(--color-text-faint)">
          <span className="flex-1">
            {extra} duplicate {extra === 1 ? "tab" : "tabs"} — shown under their page in each group
          </span>
          <button
            type="button"
            onClick={closeDuplicates}
            className="cursor-pointer rounded-md border-2 border-(--color-border-hard) bg-neon-100 px-2 py-0.5 text-[11px] font-bold text-neon-700 shadow-brutal-sm hover:shadow-brutal-pressed press-down dark:bg-neon-900/50 dark:text-neon-400"
          >
            Close all
            {showLabels && <Kbd>⇧D</Kbd>}
          </button>
        </p>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-(--color-text-faint)">
        <input type="checkbox" checked={enabled} onChange={() => void toggle()} />
        Switch to a tab that’s already open instead of opening a duplicate
      </label>
    </div>
  );
}
