import type { Summary } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { getSummaries, getSummary } from "../../lib/api";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";

function parseTimestamp(ts: string): number | null {
  // Supports "1:23", "1:23:45", "01:23"
  const parts = ts.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function extractTimestamp(text: string): { time: string; seconds: number; label: string } | null {
  // Match patterns like "1:23 - Some topic" or "[1:23] Some topic" or "1:23:45 Topic"
  const match = text.match(/^[[(\s]*(\d{1,2}:\d{2}(?::\d{2})?)[)\]\s]*[-\u2013\u2014:\s]*(.*)/);
  if (!match) return null;
  const time = match[1];
  const seconds = parseTimestamp(time);
  if (seconds === null) return null;
  return { time, seconds, label: match[2].trim() || time };
}

async function seekVideo(seconds: number) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: "SEEK_VIDEO", seconds });
    }
  } catch {
    // Content script not available — ignore
  }
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("list");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
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

      // Check URL params for ?id= to deep-link to a summary
      const params = new URLSearchParams(window.location.search);
      const summaryId = params.get("id");

      if (summaryId) {
        // Fetch the specific summary and show detail view
        const [summaryRes, listRes] = await Promise.all([getSummary(summaryId), getSummaries()]);
        setSelectedSummary(summaryRes.summary);
        setSummaries(listRes.summaries.filter((s) => s.status === "completed"));
        setView("detail");
      } else {
        // Fetch all completed summaries for list view
        const { summaries: allSummaries } = await getSummaries();
        setSummaries(allSummaries.filter((s) => s.status === "completed"));
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
  }

  function handleBack() {
    setSelectedSummary(null);
    setView("list");
  }

  function handlePopOut(id: string) {
    // summaries.html will be added in a future task — cast to bypass WXT's PublicPath type
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}` as "/popup.html");
    browser.tabs.create({ url });
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  // Not authenticated
  if (!authed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold m-0">Cliphy</h1>
        <p className="text-gray-500 mt-3 text-sm">Sign in via the popup to view summaries.</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold m-0">Cliphy</h1>
        <p className="text-red-600 mt-3 text-sm">{error}</p>
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return <DetailView summary={selectedSummary} onBack={handleBack} onPopOut={handlePopOut} />;
  }

  // List view
  return <ListView summaries={summaries} onSelect={handleSelectSummary} />;
}

function ListView({
  summaries,
  onSelect,
}: {
  summaries: Summary[];
  onSelect: (s: Summary) => void;
}) {
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold m-0">Summaries</h1>
      {summaries.length === 0 ? (
        <p className="text-gray-500 text-sm mt-4">
          No completed summaries yet. Queue a video from the popup to get started.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 list-none p-0 m-0">
          {summaries.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s)}
                className="w-full text-left p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <p className="text-sm font-medium text-gray-900 m-0 line-clamp-2">
                  {s.videoTitle || s.videoId}
                </p>
                {s.summaryJson?.summary && (
                  <p className="text-xs text-gray-500 mt-1 m-0 line-clamp-2">
                    {s.summaryJson.summary}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailView({
  summary,
  onBack,
  onPopOut,
}: {
  summary: Summary;
  onBack: () => void;
  onPopOut: (id: string) => void;
}) {
  const json = summary.summaryJson;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:text-blue-700 bg-transparent border-none cursor-pointer p-0"
        >
          &larr; All summaries
        </button>
        <button
          onClick={() => onPopOut(summary.id)}
          className="text-xs text-gray-500 hover:text-gray-700 bg-transparent border-none cursor-pointer p-0"
        >
          Pop out &nearr;
        </button>
      </div>

      {/* Video title */}
      <h2 className="text-base font-semibold text-gray-900 m-0">
        {summary.videoTitle || summary.videoId}
      </h2>

      {!json ? (
        <p className="text-gray-500 text-sm mt-3">No summary data available.</p>
      ) : (
        <>
          {/* Summary text */}
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-700 m-0 mb-2">Summary</h3>
            <p className="text-sm text-gray-800 leading-relaxed m-0 whitespace-pre-line">
              {json.summary}
            </p>
          </div>

          {/* Key points */}
          {json.keyPoints.length > 0 && (
            <div className="mt-4">
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
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-700 m-0 mb-2">Timestamps</h3>
              <ul className="list-none p-0 m-0 space-y-1">
                {json.timestamps.map((ts, i) => {
                  const parsed = extractTimestamp(ts);
                  if (parsed) {
                    return (
                      <li key={i} className="text-sm">
                        <button
                          onClick={() => seekVideo(parsed.seconds)}
                          className="text-blue-600 hover:text-blue-700 bg-transparent border-none cursor-pointer p-0 font-mono text-sm"
                        >
                          {parsed.time}
                        </button>
                        {parsed.label && <span className="text-gray-700 ml-2">{parsed.label}</span>}
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="text-sm text-gray-800">
                      {ts}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
