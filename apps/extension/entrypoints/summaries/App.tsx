import type { Summary, SummaryStatus, UsageInfo } from "@cliphy/shared";
import { formatTimeSaved, FREE_HISTORY_DAYS, UPGRADE_URL } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { SummaryDetail } from "../../components/SummaryDetail";
import { SummaryCardSkeleton } from "../../components/Skeleton";
import { getSummaries, getUsage } from "../../lib/api";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";

const STATUS_STYLES: Record<SummaryStatus, string> = {
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-600",
  processing: "bg-indigo-100 text-indigo-700",
};

function StatusBadge({ status }: { status: SummaryStatus }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded border-2 border-black ${STATUS_STYLES[status]}`}
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
        <div className="bg-red-50 border-2 border-black rounded-lg p-4 mt-4">
          <p className="text-sm text-red-700 font-bold m-0">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              init();
            }}
            className="mt-3 text-xs font-bold px-4 py-2 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
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
          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 mb-4 transition-colors"
        >
          &larr; All summaries
        </button>
        <SummaryDetail summary={selectedSummary} />
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Header usage={usage} />
      <CardList summaries={summaries} onSelect={handleSelectSummary} />
    </div>
  );
}

function Header({ usage }: { usage: UsageInfo | null }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold m-0">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        {usage && (
          <div className="text-right">
            <span className="text-xs font-bold text-gray-600">
              {usage.used}/{usage.limit} summaries today
            </span>
            {usage.totalTimeSavedSeconds > 0 && (
              <p className="text-[10px] text-gray-400 m-0">
                {formatTimeSaved(usage.totalTimeSavedSeconds)} saved
              </p>
            )}
          </div>
        )}
      </div>
      {usage?.plan === "free" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span>
            Showing last {FREE_HISTORY_DAYS} days.{" "}
            <a
              href={UPGRADE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:text-amber-800 font-bold no-underline transition-colors"
            >
              Upgrade to Pro
            </a>{" "}
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
        <p className="text-xs text-gray-400 mt-1">
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
          className="w-full text-left bg-white border-2 border-black rounded-lg p-4 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down transition-all"
        >
          <div className="flex items-start gap-3">
            <img
              src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`}
              alt=""
              className="w-16 h-12 rounded border-2 border-black object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-gray-900 m-0 line-clamp-1">
                  {s.videoTitle || s.videoId}
                </p>
                <StatusBadge status={s.status} />
              </div>
              {s.videoChannel && (
                <p className="text-[10px] text-gray-400 mt-0.5 m-0">{s.videoChannel}</p>
              )}
              {s.summaryJson?.summary && (
                <p className="text-xs text-gray-500 mt-1 m-0 line-clamp-2">
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
