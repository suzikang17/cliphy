import type { Summary } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { SummaryDetail } from "../../components/SummaryDetail";
import { SummaryCardSkeleton } from "../../components/Skeleton";
import { getSummaries, getSummary } from "../../lib/api";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";

async function seekVideo(seconds: number) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: "SEEK_VIDEO", seconds });
    }
  } catch {
    // Content script not available
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

      const params = new URLSearchParams(window.location.search);
      const summaryId = params.get("id");

      if (summaryId) {
        const [summaryRes, listRes] = await Promise.all([getSummary(summaryId), getSummaries()]);
        setSelectedSummary(summaryRes.summary);
        setSummaries(listRes.summaries.filter((s) => s.status === "completed"));
        setView("detail");
      } else {
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
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}`);
    browser.tabs.create({ url });
  }

  // Loading
  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-extrabold m-0 mb-4">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        <div className="space-y-2">
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
      <div className="p-4">
        <h1 className="text-lg font-extrabold m-0">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        <p className="text-gray-500 mt-3 text-sm">Sign in via the popup to view summaries.</p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-extrabold m-0">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        <div className="mt-4 bg-red-50 border-2 border-black rounded-lg p-3">
          <p className="text-sm text-red-700 font-bold m-0">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              init();
            }}
            className="mt-2 text-xs font-bold px-3 py-1.5 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
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
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={handleBack}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            &larr; All summaries
          </button>
          <button
            onClick={() => handlePopOut(selectedSummary.id)}
            className="text-xs text-gray-400 hover:text-black bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            Pop out &nearr;
          </button>
        </div>
        <SummaryDetail summary={selectedSummary} onSeek={seekVideo} />
      </div>
    );
  }

  // List view
  return (
    <div className="p-4">
      <h1 className="text-lg font-extrabold m-0 mb-4">
        <span className="text-indigo-500">&#9654;</span> Cliphy
      </h1>
      {summaries.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm font-bold m-0">No summaries yet</p>
          <p className="text-xs text-gray-400 mt-1">Queue a video from the popup to get started.</p>
        </div>
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {summaries.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => handleSelectSummary(s)}
                className="w-full text-left bg-white border-2 border-black rounded-lg px-3 py-2 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down"
              >
                <div className="flex gap-2">
                  <img
                    src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`}
                    alt=""
                    className="w-12 h-9 rounded border border-gray-300 object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug m-0 truncate">
                      {s.videoTitle || s.videoId}
                    </p>
                    {s.summaryJson?.summary && (
                      <p className="text-[10px] text-gray-400 mt-0.5 m-0 line-clamp-2">
                        {s.summaryJson.summary}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
