import { useEffect, useState } from "react";
import type { Tabs } from "wxt/browser";
import { stowTab } from "../../lib/api";

interface OpenTab {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

interface StowTabsPanelProps {
  onClose: () => void;
  onStowed: (count: number, reopenUrls: string[]) => void;
}

/** Pages that cannot be captured, and Cliphy's own surfaces. */
function isStowable(tab: Tabs.Tab): boolean {
  const url = tab.url ?? "";
  if (!url.startsWith("http")) return false; // chrome://, about:, file://, extension pages
  return true;
}

export function StowTabsPanel({ onClose, onStowed }: StowTabsPanelProps) {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [summarize, setSummarize] = useState<Set<number>>(new Set());
  const [closeAfter, setCloseAfter] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const all = await browser.tabs.query({ currentWindow: true });
      const usable = all.filter(isStowable).filter((t: Tabs.Tab) => t.id != null);
      const mapped = usable.map((t: Tabs.Tab) => ({
        id: t.id as number,
        url: t.url as string,
        title: t.title || (t.url as string),
        favIconUrl: t.favIconUrl,
      }));
      setTabs(mapped);
      const ids = mapped.map((t: OpenTab) => t.id);
      setSelected(new Set(ids)); // all checked by default
      setCloseAfter(new Set(ids)); // stow-and-close is the common case
    })();
  }, []);

  function toggle(set: Set<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // Invariant: AI summary requires stowing. Summarizing something you are not
  // saving has nowhere to put the result, so the two controls move together.
  function toggleStow(id: number) {
    setSelected((prev) => {
      const next = toggle(prev, id);
      if (!next.has(id)) setSummarize((s) => (s.has(id) ? toggle(s, id) : s));
      return next;
    });
  }

  function toggleSummarize(id: number) {
    setSummarize((prev) => {
      const next = toggle(prev, id);
      if (next.has(id)) setSelected((sel) => (sel.has(id) ? sel : new Set(sel).add(id)));
      return next;
    });
  }

  async function handleStow() {
    const toStow = tabs.filter((t) => selected.has(t.id));
    if (toStow.length === 0 && closeAfter.size === 0) return;
    setBusy(true);
    setError(null);

    const stowed: OpenTab[] = [];
    for (const tab of toStow) {
      try {
        await stowTab(tab.url, summarize.has(tab.id));
        stowed.push(tab);
      } catch {
        // A duplicate (409) or a failed save. Leave it open — never close a tab
        // we did not manage to save.
      }
    }

    if (toStow.length > 0 && stowed.length === 0) {
      setError("Couldn't stow those tabs.");
      setBusy(false);
      return;
    }

    // Closing is independent of stowing: a tab marked for closing but not for
    // stowing is just being dismissed, and has nothing to lose. A tab marked
    // for both closes only if its save actually succeeded.
    const stowedIds = new Set(stowed.map((t) => t.id));
    const toClose = tabs.filter(
      (t) => closeAfter.has(t.id) && (!selected.has(t.id) || stowedIds.has(t.id)),
    );
    if (toClose.length > 0) await browser.tabs.remove(toClose.map((t) => t.id));

    onStowed(
      stowed.length,
      toClose.map((t) => t.url),
    );
    setBusy(false);
    onClose();
  }

  const allSelected = tabs.length > 0 && selected.size === tabs.length;
  const closingCount = closeAfter.size;
  const sameSet = closingCount === selected.size && [...selected].every((id) => closeAfter.has(id));
  const stowLabel =
    selected.size === 0
      ? `Close ${closingCount}`
      : closingCount === 0
        ? `Stow ${selected.size}`
        : sameSet
          ? `Stow ${selected.size} & close`
          : `Stow ${selected.size} · close ${closingCount}`;

  return (
    <div className="mb-4 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) p-3 shadow-brutal-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-extrabold text-(--color-text)">Stow open tabs</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-(--color-text-faint) hover:text-(--color-text)"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {tabs.length === 0 ? (
        <p className="text-xs text-(--color-text-faint)">No stowable tabs in this window.</p>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase text-(--color-text-faint)">
            <button
              type="button"
              onClick={() => setSelected(allSelected ? new Set() : new Set(tabs.map((t) => t.id)))}
              className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold uppercase text-(--color-text-faint) hover:text-(--color-text)"
            >
              {allSelected ? "None" : "All"}
            </button>
            <span className="flex shrink-0 gap-2">
              <span title="Queue for AI summary">✦ AI</span>
              <span title="Close the tab after stowing">✕</span>
            </span>
          </div>

          <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {tabs.map((tab) => (
              <li key={tab.id} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={selected.has(tab.id)}
                  onChange={() => toggleStow(tab.id)}
                  aria-label={`Stow ${tab.title}`}
                  className="shrink-0 cursor-pointer"
                />
                {tab.favIconUrl ? (
                  <img src={tab.favIconUrl} alt="" width={16} height={16} className="shrink-0" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-(--color-text)">
                  {tab.title}
                </span>
                <input
                  type="checkbox"
                  checked={summarize.has(tab.id)}
                  onChange={() => toggleSummarize(tab.id)}
                  aria-label={`Queue ${tab.title} for AI summary`}
                  className="shrink-0 cursor-pointer"
                />
                <input
                  type="checkbox"
                  checked={closeAfter.has(tab.id)}
                  onChange={() => setCloseAfter((s) => toggle(s, tab.id))}
                  aria-label={`Close ${tab.title}`}
                  className="shrink-0 cursor-pointer"
                />
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-(--color-border-soft) pt-2">
            <span className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (summarize.size === tabs.length) {
                    setSummarize(new Set());
                  } else {
                    const all = new Set(tabs.map((t) => t.id));
                    setSummarize(all);
                    setSelected(all); // AI implies stow
                  }
                }}
                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text-faint) hover:text-(--color-text)"
              >
                ✦ AI for all
              </button>
              <button
                type="button"
                onClick={() =>
                  setCloseAfter(
                    closeAfter.size === tabs.length ? new Set() : new Set(tabs.map((t) => t.id)),
                  )
                }
                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text-faint) hover:text-(--color-text)"
              >
                ✕ Close all
              </button>
            </span>
            <button
              type="button"
              onClick={() => void handleStow()}
              disabled={busy || (selected.size === 0 && closeAfter.size === 0)}
              className="cursor-pointer rounded-lg border-2 border-(--color-border-hard) bg-neon-100 px-3 py-1.5 text-xs font-bold text-neon-700 shadow-brutal-sm disabled:opacity-50 dark:bg-neon-900/50 dark:text-neon-400"
            >
              {busy ? "Stowing…" : stowLabel}
            </button>
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
