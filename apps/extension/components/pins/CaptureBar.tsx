import { useState } from "react";
import type { PinnedItem } from "@cliphy/shared";
import { addBookmark, appendNote, localDate } from "../../lib/api";
import { looksLikeUrl, toUrl } from "./isUrl";

interface CaptureBarProps {
  onAdded: (pin: PinnedItem) => void;
  /** Called after text is written to today's note, so the editor can refresh. */
  onNoted?: () => void;
}

export function CaptureBar({ onAdded, onNoted }: CaptureBarProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // One box, two behaviours: a link becomes a bookmark tile, anything else
      // becomes a line in today's note.
      if (looksLikeUrl(trimmed)) {
        const { pin } = await addBookmark(toUrl(trimmed));
        onAdded(pin);
      } else {
        await appendNote(trimmed, localDate());
        onNoted?.();
      }
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function clipCurrentTab() {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) await submit(tab.url);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit(url);
        }}
        placeholder="Paste a link, or jot a note…"
        disabled={busy}
        aria-label="Paste a link, or jot a note"
        className="min-w-0 flex-1 rounded-lg border-2 border-black bg-[#f9fafb] px-3 py-2 text-sm shadow-[3px_3px_0_0_rgba(0,0,0,1)] dark:border-[#505050] dark:bg-[#282828] dark:text-white dark:shadow-[3px_3px_0_0_rgba(255,255,255,0.12)]"
      />
      <button
        type="button"
        onClick={() => void clipCurrentTab()}
        disabled={busy}
        className="rounded-lg border-2 border-black bg-[#f9fafb] px-3 py-2 text-sm font-bold shadow-[3px_3px_0_0_rgba(0,0,0,1)] dark:border-[#505050] dark:bg-[#282828] dark:text-white dark:shadow-[3px_3px_0_0_rgba(255,255,255,0.12)]"
      >
        {busy ? "Adding…" : "Clip this tab"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
