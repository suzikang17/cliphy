import { useState } from "react";
import type { PinnedItem } from "@cliphy/shared";
import { addBookmark } from "../../lib/api";

interface CaptureBarProps {
  onAdded: (pin: PinnedItem) => void;
}

export function CaptureBar({ onAdded }: CaptureBarProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const { pin } = await addBookmark(trimmed);
      onAdded(pin);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that link.");
    } finally {
      setBusy(false);
    }
  }

  async function clipCurrentTab() {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) await submit(tab.url);
  }

  return (
    <div className="mb-6 flex items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit(url);
        }}
        placeholder="Paste a URL to pin…"
        disabled={busy}
        aria-label="Paste a URL to pin"
        className="flex-1 rounded-lg border-2 border-black bg-[#f9fafb] px-3 py-2 text-sm shadow-[3px_3px_0_0_rgba(0,0,0,1)] dark:border-[#505050] dark:bg-[#282828] dark:text-white dark:shadow-[3px_3px_0_0_rgba(255,255,255,0.12)]"
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
