import type { Summary } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";
import { useState } from "react";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onViewAll?: () => void;
}

const PAGE_SIZE = 10;

export function QueueList({
  summaries,
  onViewSummary,
  onRemove,
  onRetry,
  onViewAll,
}: QueueListProps) {
  const [page, setPage] = useState(1);

  if (summaries.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-sm font-bold">No videos queued yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Visit a YouTube video and click &quot;Add to Queue&quot;
        </p>
      </div>
    );
  }

  const visible = summaries.slice(0, page * PAGE_SIZE);
  const hasMore = summaries.length > visible.length;

  return (
    <ul className="space-y-2">
      {visible.map((s) => {
        const isClickable = s.status === "completed";
        const isProcessing = s.status === "pending" || s.status === "processing";
        const isFailed = s.status === "failed";
        return (
          <li
            key={s.id}
            onClick={isClickable ? () => onViewSummary(s.id) : undefined}
            className={`flex items-start gap-2 bg-white border-2 border-black rounded-lg px-3 py-2 shadow-brutal-sm ${
              isClickable ? "cursor-pointer hover:shadow-brutal-pressed press-down" : ""
            }`}
          >
            <div className="relative shrink-0">
              <img
                src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`}
                alt=""
                className={`w-[88px] h-[50px] rounded border border-gray-300 object-cover ${isProcessing ? "brightness-50" : ""}`}
              />
              {isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug line-clamp-2">
                {s.videoTitle ?? s.videoId}
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 truncate">
                {s.videoChannel && <span>{s.videoChannel}</span>}
                {s.videoChannel && s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
                  <span>&middot;</span>
                )}
                {s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
                  <span>{formatTimeSaved(s.videoDurationSeconds)} video</span>
                )}
                {(s.videoChannel ||
                  (s.videoDurationSeconds != null && s.videoDurationSeconds > 0)) && (
                  <span>&middot;</span>
                )}
                <span>{timeAgo(s.createdAt)}</span>
              </div>
              {isFailed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(s.id);
                  }}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer transition-colors mt-0.5"
                >
                  Retry
                </button>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-center gap-1 self-stretch justify-center">
              <button
                disabled={isProcessing}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(s.id);
                }}
                className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 p-0 cursor-pointer transition-colors"
                aria-label="Remove"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="1" y1="1" x2="9" y2="9" />
                  <line x1="9" y1="1" x2="1" y2="9" />
                </svg>
              </button>
              {isClickable && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-green-600"
                >
                  <path d="M1 7h12M8 2l5 5-5 5" />
                </svg>
              )}
              {isProcessing && (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
              )}
              {isFailed && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-red-400"
                >
                  <circle cx="7" cy="7" r="6" />
                  <line x1="7" y1="4" x2="7" y2="7.5" />
                  <circle cx="7" cy="10" r="0.5" fill="currentColor" />
                </svg>
              )}
            </div>
          </li>
        );
      })}
      {hasMore && (
        <li>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="w-full text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1.5 cursor-pointer bg-transparent border-0 transition-colors text-center"
          >
            Show more ({summaries.length - visible.length} remaining)
          </button>
        </li>
      )}
      {onViewAll && (
        <li>
          <button
            onClick={onViewAll}
            className="w-full text-xs font-bold text-gray-400 hover:text-black py-1.5 cursor-pointer bg-transparent border-0 transition-colors text-center"
          >
            View all &rarr;
          </button>
        </li>
      )}
    </ul>
  );
}
