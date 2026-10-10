import { useEffect, useMemo, useState } from "react";
import { findDuplicates, pickKeeper } from "../../lib/tabs/dedupe";
import {
  isDedupeEnabled,
  LAST_INTERCEPT_KEY,
  setDedupeEnabled,
  undoIntercept,
  type LastIntercept,
} from "../../lib/tabs/interceptDupes";
import type { OpenTab } from "../../lib/tabs/types";

const UNDO_WINDOW_MS = 60_000;

interface DuplicatesPanelProps {
  tabs: OpenTab[];
  onActivate: (tab: OpenTab) => void;
  onCloseTabs: (ids: number[]) => void;
}

/** Duplicate tabs at a glance: one-click cleanup, the auto-switch toggle, and Undo. */
export function DuplicatesPanel({ tabs, onActivate, onCloseTabs }: DuplicatesPanelProps) {
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
    const ids = dupes.flatMap((copies) => {
      const keep = pickKeeper(copies);
      return copies.filter((t) => t.id !== keep.id).map((t) => t.id);
    });
    onCloseTabs(ids);
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
        <section className="rounded-lg border-2 border-(--color-border-hard) p-2">
          <header className="mb-1 flex items-center gap-2">
            <h3 className="m-0 flex-1 text-xs font-black text-(--color-text)">
              Duplicates <span className="font-semibold text-(--color-text-faint)">{extra}</span>
            </h3>
            <button
              type="button"
              onClick={closeDuplicates}
              className="cursor-pointer rounded-md border-2 border-(--color-border-hard) bg-neon-100 px-2 py-0.5 text-[11px] font-bold text-neon-700 shadow-brutal-sm hover:shadow-brutal-pressed press-down dark:bg-neon-900/50 dark:text-neon-400"
            >
              Close duplicates
            </button>
          </header>
          <ul className="m-0 list-none p-0">
            {dupes.map((copies) => {
              const keep = pickKeeper(copies);
              return (
                <li key={keep.id} className="flex items-center gap-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => onActivate(keep)}
                    title={keep.url}
                    className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-xs font-semibold text-(--color-text)"
                  >
                    {keep.title}
                  </button>
                  <span className="shrink-0 text-[11px] font-bold text-(--color-text-faint)">
                    ×{copies.length}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-(--color-text-faint)">
        <input type="checkbox" checked={enabled} onChange={() => void toggle()} />
        Switch to a tab that’s already open instead of opening a duplicate
      </label>
    </div>
  );
}
