import { useState } from "react";
import { rankSites, type SiteSuggestion } from "./historySuggestions";

interface SuggestedTilesProps {
  /** Origins already on the tile strip, so we never suggest a duplicate. */
  pinnedUrls: string[];
  onPin: (suggestion: SiteSuggestion) => Promise<void>;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function SuggestedTiles({ pinnedUrls, onPin }: SuggestedTilesProps) {
  const [suggestions, setSuggestions] = useState<SiteSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  async function loadSuggestions() {
    setBusy(true);
    setDenied(false);
    try {
      // Ask only when the user opts in — see the manifest comment.
      const granted = await browser.permissions.request({ permissions: ["history"] });
      if (!granted) {
        setDenied(true);
        return;
      }
      const items = await browser.history.search({
        text: "",
        startTime: Date.now() - THIRTY_DAYS_MS,
        maxResults: 1000,
      });
      setSuggestions(rankSites(items, { excludeOrigins: pinnedUrls, limit: 10 }));
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  }

  async function handlePin(s: SiteSuggestion) {
    setPinning(s.origin);
    try {
      await onPin(s);
      setSuggestions((prev) => prev?.filter((x) => x.origin !== s.origin) ?? null);
    } finally {
      setPinning(null);
    }
  }

  if (suggestions === null) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => void loadSuggestions()}
          disabled={busy}
          className="cursor-pointer rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-1.5 text-xs font-bold text-(--color-text) shadow-brutal-sm hover:shadow-brutal-pressed disabled:opacity-50"
        >
          {busy ? "Reading history…" : "Suggest tiles from history"}
        </button>
        {denied && (
          <p className="mt-1 text-xs text-(--color-text-faint)">
            Needs history access to suggest sites.
          </p>
        )}
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <p className="mb-4 text-xs text-(--color-text-faint)">
        Nothing new to suggest — your most-visited sites are already pinned.
      </p>
    );
  }

  return (
    <div className="mb-4 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) p-3 shadow-brutal-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-(--color-text-faint)">
          Suggested from your history
        </span>
        <button
          type="button"
          onClick={() => setSuggestions(null)}
          aria-label="Dismiss suggestions"
          className="cursor-pointer border-0 bg-transparent text-(--color-text-faint) hover:text-(--color-text)"
        >
          ✕
        </button>
      </div>
      <ul className="m-0 list-none p-0">
        {suggestions.map((s) => (
          <li key={s.origin} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-(--color-text)">
              {s.host}
            </span>
            <span className="shrink-0 text-[10px] text-(--color-text-faint)">{s.visits}×</span>
            <button
              type="button"
              onClick={() => void handlePin(s)}
              disabled={pinning === s.origin}
              aria-label={`Pin ${s.host}`}
              className="shrink-0 cursor-pointer rounded border-2 border-(--color-border-hard) px-2 py-0.5 text-xs font-bold text-(--color-text) disabled:opacity-50"
            >
              {pinning === s.origin ? "…" : "+"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
