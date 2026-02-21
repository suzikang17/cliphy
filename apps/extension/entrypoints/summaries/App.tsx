import type { Summary, SummaryStatus, UsageInfo } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { getSummaries, getUsage } from "../../lib/api";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";

const STATUS_STYLES: Record<SummaryStatus, string> = {
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-yellow-100 text-yellow-800",
};

function StatusBadge({ status }: { status: SummaryStatus }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
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

      // Deep-link support: parse hash for #/summary/{id}
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

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  // Not authenticated
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Sign in via the extension popup to view summaries.</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={usage} />
        <DetailView summary={selectedSummary} onBack={handleBack} />
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
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-bold m-0">Cliphy</h1>
      {usage && (
        <span className="text-sm text-gray-500">
          {usage.used}/{usage.limit} summaries today
        </span>
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
        <p className="text-gray-500">
          No summaries yet. Visit a YouTube video and queue it from the Cliphy popup.
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
          className="w-full text-left p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer transition-colors shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 m-0 line-clamp-1">
                {s.videoTitle || s.videoId}
              </p>
              {s.summaryJson?.summary && (
                <p className="text-xs text-gray-500 mt-1 m-0 line-clamp-2">
                  {s.summaryJson.summary}
                </p>
              )}
            </div>
            <StatusBadge status={s.status} />
          </div>
        </button>
      ))}
    </div>
  );
}

function DetailView({ summary, onBack }: { summary: Summary; onBack: () => void }) {
  const json = summary.summaryJson;

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="text-sm text-blue-600 hover:text-blue-700 bg-transparent border-none cursor-pointer p-0 mb-4"
      >
        &larr; Back to all summaries
      </button>

      {/* Title + status */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-xl font-semibold text-gray-900 m-0">
          {summary.videoTitle || summary.videoId}
        </h2>
        <StatusBadge status={summary.status} />
      </div>

      {!json ? (
        <p className="text-gray-500 text-sm">No summary data available.</p>
      ) : (
        <>
          {/* Summary text */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700 m-0 mb-2">Summary</h3>
            <p className="text-sm text-gray-800 leading-relaxed m-0 whitespace-pre-line">
              {json.summary}
            </p>
          </div>

          {/* Key points */}
          {json.keyPoints.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 m-0 mb-2">Key Points</h3>
              <ul className="list-disc pl-5 m-0 space-y-1">
                {json.keyPoints.map((point, i) => (
                  <li key={i} className="text-sm text-gray-800">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamps */}
          {json.timestamps.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 m-0 mb-2">Timestamps</h3>
              <ul className="list-none p-0 m-0 space-y-1">
                {json.timestamps.map((ts, i) => (
                  <li key={i} className="text-sm text-gray-800">
                    {ts}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
