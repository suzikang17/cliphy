import type { Summary, SummaryStatus, UsageInfo } from "@cliphy/shared";
import { formatTimeSaved, FREE_HISTORY_DAYS, MAX_FREE_UNIQUE_TAGS } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { SummaryDetail } from "../../components/SummaryDetail";
import { SummaryCardSkeleton } from "../../components/Skeleton";
import {
  getAllTags,
  getSummaries,
  getUsage,
  TagLimitError,
  updateSummaryTags,
} from "../../lib/api";
import { openCheckout } from "../../lib/checkout";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";

const STATUS_STYLES: Record<SummaryStatus, string> = {
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-600",
  processing: "bg-neon-100 text-neon-700",
};

function StatusBadge({ status }: { status: SummaryStatus }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded border-2 border-(--color-border-hard) ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function parseSummaryIdFromHash(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/summary\/(.+)$/);
  return match ? match[1] : null;
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("list");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      const authenticated = await isAuthenticated();
      setAuthed(authenticated);
      if (!authenticated) {
        setLoading(false);
        return;
      }

      const [summariesRes, usageRes] = await Promise.all([getSummaries(), getUsage()]);
      setSummaries(summariesRes.summaries);
      setUsage(usageRes.usage);

      // Tags fetch is non-fatal — page works without autocomplete
      try {
        const tagsRes = await getAllTags();
        setAllTags(tagsRes.tags);
      } catch {
        // Tags endpoint may not be deployed yet
      }

      const deepLinkId = parseSummaryIdFromHash();
      if (deepLinkId) {
        const match = summariesRes.summaries.find((s) => s.id === deepLinkId);
        if (match) {
          setSelectedSummary(match);
          setView("detail");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summaries");
    } finally {
      setLoading(false);
    }
  }

  async function fetchSummaries(tag?: string | null) {
    const res = await getSummaries(tag ?? undefined);
    setSummaries(res.summaries);
  }

  async function handleFilterTag(tag: string | null) {
    setFilterTag(tag);
    try {
      await fetchSummaries(tag);
    } catch {
      // silently fail — list stays as-is
    }
  }

  async function handleTagsChange(summaryId: string, newTags: string[]) {
    try {
      const res = await updateSummaryTags(summaryId, newTags);
      // Update local state
      setSummaries((prev) => prev.map((s) => (s.id === summaryId ? { ...s, tags: res.tags } : s)));
      if (selectedSummary?.id === summaryId) {
        setSelectedSummary((prev) => (prev ? { ...prev, tags: res.tags } : prev));
      }
      // Refresh allTags for autocomplete
      const tagsRes = await getAllTags();
      setAllTags(tagsRes.tags);
    } catch (err) {
      if (err instanceof TagLimitError) {
        // Refresh tags to get accurate count, but don't throw
        const tagsRes = await getAllTags();
        setAllTags(tagsRes.tags);
      }
      throw err;
    }
  }

  function handleSelectSummary(summary: Summary) {
    setSelectedSummary(summary);
    setView("detail");
    window.location.hash = `#/summary/${summary.id}`;
  }

  function handleBack() {
    setSelectedSummary(null);
    setView("list");
    window.location.hash = "";
  }

  // Loading
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="space-y-3">
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!authed) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="text-center py-16">
          <p className="text-sm font-bold">Sign in via the extension popup to view summaries.</p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="bg-(--color-error-surface) border-2 border-(--color-border-hard) rounded-lg p-4 mt-4">
          <p className="text-sm text-red-700 font-bold m-0">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              init();
            }}
            className="mt-3 text-xs font-bold px-4 py-2 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={usage} />
        <button
          onClick={handleBack}
          className="text-xs font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 cursor-pointer p-0 mb-4 transition-colors"
        >
          &larr; All summaries
        </button>
        <SummaryDetail
          summary={selectedSummary}
          allTags={allTags}
          tagLimitReached={usage?.plan === "free" && allTags.length >= MAX_FREE_UNIQUE_TAGS}
          onTagsChange={(tags) => handleTagsChange(selectedSummary.id, tags)}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Header usage={usage} allTags={allTags} filterTag={filterTag} onFilterTag={handleFilterTag} />
      <CardList summaries={summaries} onSelect={handleSelectSummary} />
    </div>
  );
}

function Header({
  usage,
  allTags,
  filterTag,
  onFilterTag,
}: {
  usage: UsageInfo | null;
  allTags?: string[];
  filterTag?: string | null;
  onFilterTag?: (tag: string | null) => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold m-0">
          <span className="text-neon-500">&#9654;</span> Cliphy
        </h1>
        {usage && (
          <div className="text-right">
            <span className="text-xs font-bold text-(--color-text-secondary)">
              {usage.used}/{usage.limit} summaries today
            </span>
            {usage.totalTimeSavedSeconds > 0 && (
              <p className="text-[10px] text-(--color-text-faint) m-0">
                {formatTimeSaved(usage.totalTimeSavedSeconds)} saved
              </p>
            )}
          </div>
        )}
      </div>
      {allTags && allTags.length > 0 && onFilterTag && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={filterTag ?? ""}
            onChange={(e) => onFilterTag(e.target.value || null)}
            className="text-xs font-bold px-2 py-1 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) cursor-pointer"
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      )}
      {usage?.plan === "free" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-(--color-text-muted) bg-(--color-warn-surface) border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <span>
            Showing last {FREE_HISTORY_DAYS} days.{" "}
            <button
              onClick={() => openCheckout()}
              className="text-amber-600 hover:text-amber-800 font-bold bg-transparent border-0 p-0 cursor-pointer transition-colors"
            >
              Upgrade to Pro
            </button>{" "}
            for unlimited history.
          </span>
        </div>
      )}
    </div>
  );
}

function CardList({
  summaries,
  onSelect,
}: {
  summaries: Summary[];
  onSelect: (s: Summary) => void;
}) {
  if (summaries.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-bold">No summaries yet</p>
        <p className="text-xs text-(--color-text-faint) mt-1">
          Visit a YouTube video and queue it from the Cliphy popup.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {summaries.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s)}
          className="w-full text-left bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-4 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down transition-all"
        >
          <div className="flex items-start gap-3">
            <img
              src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`}
              alt=""
              className="w-44 h-24 rounded-lg border-2 border-(--color-border-hard) object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-(--color-text) m-0 line-clamp-1">
                  {s.videoTitle || s.videoId}
                </p>
                <StatusBadge status={s.status} />
              </div>
              {s.videoChannel && (
                <p className="text-[10px] text-(--color-text-faint) mt-0.5 m-0">{s.videoChannel}</p>
              )}
              {s.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-neon-100 text-neon-700 border border-neon-300 dark:bg-neon-900/30 dark:text-neon-400 dark:border-neon-700 font-bold"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {s.summaryJson?.summary && (
                <p className="text-xs text-(--color-text-muted) mt-1 m-0 line-clamp-2">
                  {s.summaryJson.summary}
                </p>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
