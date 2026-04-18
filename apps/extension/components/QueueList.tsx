import type { Summary, VideoInfo } from "@cliphy/shared";
import {
  formatTimeSaved,
  MAX_VIDEO_DURATION_SECONDS,
  parseDurationToSeconds,
} from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";

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
  currentVideo: VideoInfo | null;
  videoLoading?: boolean;
  loadingVideoId?: string | null;
  onAddToQueue: () => void;
  isAdding: boolean;
  addStatus: "idle" | "queued" | "processing" | "error";
  addError?: string;
  atLimit?: boolean;
  onUpgrade?: () => void;
  onViewSummary: (id: string) => void;
  onOpenSummary: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const PAGE_SIZE = 10;

export function QueueList({
  summaries,
  currentVideo,
  videoLoading,
  loadingVideoId,
  onAddToQueue,
  isAdding,
  addStatus,
  addError,
  atLimit,
  onUpgrade,
  onViewSummary,
  onOpenSummary,
  onRemove,
  onRetry,
}: QueueListProps) {
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPage((p) => p + 1);
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [page, summaries.length]);

  // Find if current video already exists in the queue
  const matchedSummary = currentVideo
    ? summaries.find((s) => s.videoId === currentVideo.videoId)
    : null;

  // Remove matched summary from normal list to avoid duplication
  const filteredSummaries = matchedSummary
    ? summaries.filter((s) => s.id !== matchedSummary.id)
    : summaries;

  const hasItems = filteredSummaries.length > 0 || currentVideo !== null || videoLoading;

  if (!hasItems) {
    return (
      <div className="text-center py-6 px-4 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm">
        <p className="text-2xl mb-2">🎬</p>
        <p className="text-sm font-bold">No videos queued yet</p>
        <p className="text-xs text-(--color-text-faint) mt-1">
          Visit a YouTube video and click &quot;Summarize Video&quot;
        </p>
      </div>
    );
  }

  const visible = filteredSummaries.slice(0, page * PAGE_SIZE);
  const hasMore = filteredSummaries.length > visible.length;

  return (
    <ul className="space-y-2">
      {!currentVideo && videoLoading && <SkeletonCard videoId={loadingVideoId} />}
      {currentVideo &&
        (matchedSummary ? (
          <CurrentMatchedItem
            summary={matchedSummary}
            video={currentVideo}
            onViewSummary={onViewSummary}
            onOpenSummary={onOpenSummary}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ) : (
          <CurrentVideoItem
            video={currentVideo}
            onAdd={onAddToQueue}
            isAdding={isAdding}
            addStatus={addStatus}
            addError={addError}
            atLimit={atLimit}
            onUpgrade={onUpgrade}
          />
        ))}
      {visible.map((s) => (
        <QueueItem
          key={s.id}
          summary={s}
          onViewSummary={onViewSummary}
          onOpenSummary={onOpenSummary}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      ))}
      {hasMore && <li ref={sentinelRef} className="h-1" />}
    </ul>
  );
}

/** Existing queue item (summary row) */
function QueueItem({
  summary: s,
  onViewSummary,
  onOpenSummary,
  onRemove,
  onRetry,
}: {
  summary: Summary;
  onViewSummary: (id: string) => void;
  onOpenSummary: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const isClickable = s.status === "completed";
  const isProcessing = s.status === "pending" || s.status === "processing";
  const isFailed = s.status === "failed";

  return (
    <li
      key={s.id}
      onClick={isClickable ? () => onViewSummary(s.id) : undefined}
      className={`flex items-start gap-2 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg px-3 py-2 shadow-brutal-sm ${
        isClickable ? "cursor-pointer hover:shadow-brutal-pressed press-down" : ""
      }`}
    >
      <a
        href={`https://www.youtube.com/watch?v=${s.videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="relative shrink-0"
      >
        <img
          src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`}
          alt=""
          className={`w-[88px] h-[50px] rounded border border-(--color-border-muted) object-cover ${isProcessing ? "brightness-50" : ""}`}
        />
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          </div>
        )}
      </a>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug line-clamp-2">{s.videoTitle ?? s.videoId}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-(--color-text-faint) truncate">
          {s.videoChannel && <span>{s.videoChannel}</span>}
          {s.videoChannel && s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
            <span>&middot;</span>
          )}
          {s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
            <span>{formatTimeSaved(s.videoDurationSeconds)} video</span>
          )}
          {(s.videoChannel || (s.videoDurationSeconds != null && s.videoDurationSeconds > 0)) && (
            <span>&middot;</span>
          )}
          <span>{timeAgo(s.createdAt)}</span>
        </div>
        {isFailed && s.errorMessage && (
          <p className="text-[10px] text-red-500 leading-tight mt-0.5 mb-0">{s.errorMessage}</p>
        )}
        {isFailed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry(s.id);
            }}
            className="text-[10px] font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 p-0 cursor-pointer transition-colors mt-0.5"
          >
            Retry
          </button>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1 self-stretch justify-between">
        <div>
          {isClickable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSummary(s.id);
              }}
              className="bg-transparent border-0 p-0 cursor-pointer active:translate-x-[1px] active:translate-y-[1px] transition-all"
              aria-label="Open in new tab"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neon-600 opacity-50 hover:opacity-100 transition-all"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          )}
          {isProcessing && (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-neon-200 border-t-neon-600 animate-spin" />
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
        <button
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(s.id);
          }}
          className="w-5 h-5 flex items-center justify-center text-(--color-text-faint) hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 p-0 cursor-pointer transition-colors"
          aria-label="Remove"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/** Current video already in queue — bigger card with status button */
function CurrentMatchedItem({
  summary: s,
  video,
  onViewSummary,
  onOpenSummary,
  onRemove,
  onRetry,
}: {
  summary: Summary;
  video: VideoInfo;
  onViewSummary: (id: string) => void;
  onOpenSummary: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const isCompleted = s.status === "completed";
  const isProcessing = s.status === "pending" || s.status === "processing";
  const isFailed = s.status === "failed";

  return (
    <li className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal">
      <div className="flex gap-3">
        <a
          href={`https://www.youtube.com/watch?v=${s.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="relative shrink-0"
        >
          <img
            src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`}
            alt=""
            className={`w-20 h-auto rounded border-2 border-(--color-border-hard) object-cover ${isProcessing ? "brightness-50" : ""}`}
          />
          {isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            </div>
          )}
        </a>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug line-clamp-2">
            {s.videoTitle ?? video.title}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-(--color-text-muted)">
            {s.videoChannel && <span>{s.videoChannel}</span>}
            {s.videoChannel && video.duration && <span>&middot;</span>}
            {video.duration && <span>{video.duration}</span>}
          </div>
          {isFailed && s.errorMessage && (
            <p className="text-[10px] text-red-500 leading-tight mt-1 mb-0">{s.errorMessage}</p>
          )}
        </div>
      </div>
      {isCompleted ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onViewSummary(s.id)}
            className="flex-1 py-2 text-sm text-neon-800 bg-neon-100 dark:bg-neon-900 dark:text-neon-200 cursor-pointer border-2 border-(--color-border-hard) rounded-full font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down active:translate-x-[3px] active:translate-y-[3px] active:shadow-none flex items-center justify-center gap-1"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View Summary
          </button>
          <button
            onClick={() => onOpenSummary(s.id)}
            className="py-2 px-3 bg-(--color-surface) cursor-pointer border-2 border-(--color-border-hard) rounded-full shadow-brutal-sm hover:shadow-brutal-pressed press-down active:translate-x-[3px] active:translate-y-[3px] active:shadow-none flex items-center justify-center"
            aria-label="Open in new tab"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-neon-600"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      ) : isFailed ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onRetry(s.id)}
            className="flex-1 py-2 text-sm bg-neon-600 text-white cursor-pointer border-2 border-(--color-border-hard) rounded-full font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down"
          >
            Retry
          </button>
          <button
            onClick={() => onRemove(s.id)}
            className="py-2 px-3 text-sm bg-(--color-surface-raised) text-(--color-text-faint) cursor-pointer border-2 border-(--color-border-muted) rounded-full font-bold hover:text-red-500 transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          disabled
          className="mt-3 w-full py-2 text-sm bg-(--color-surface-raised) text-(--color-text-faint) cursor-not-allowed border-2 border-(--color-border-muted) rounded-full font-bold"
        >
          {s.status === "processing" ? "Processing..." : "Queued"}
        </button>
      )}
    </li>
  );
}

/** Current video not yet in queue — bigger card with full-width button */
function CurrentVideoItem({
  video,
  onAdd,
  isAdding,
  addStatus,
  addError,
  atLimit,
  onUpgrade,
}: {
  video: VideoInfo;
  onAdd: () => void;
  isAdding: boolean;
  addStatus: "idle" | "queued" | "processing" | "error";
  addError?: string;
  atLimit?: boolean;
  onUpgrade?: () => void;
}) {
  const durationSeconds = video.duration ? (parseDurationToSeconds(video.duration) ?? 0) : 0;
  const isTooLong = durationSeconds > MAX_VIDEO_DURATION_SECONDS;
  const isLive = video.isLive;
  const isDisabled =
    isAdding || addStatus === "queued" || addStatus === "processing" || isTooLong || isLive;

  return (
    <li className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal">
      <div className="flex gap-3">
        {video.videoId && (
          <img
            src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}
            alt=""
            className="w-20 h-auto rounded border-2 border-(--color-border-hard) object-cover shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug line-clamp-2">{video.title}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-(--color-text-muted)">
            {video.channel && <span>{video.channel}</span>}
            {video.channel && video.duration && <span>&middot;</span>}
            {video.duration && <span>{video.duration}</span>}
          </div>
          {isLive && (
            <p className="text-[10px] text-red-500 mt-1 mb-0">
              Livestreams can&apos;t be summarized
            </p>
          )}
          {isTooLong && !isLive && (
            <p className="text-[10px] text-red-500 mt-1 mb-0">
              Too long to summarize (max 4 hours)
            </p>
          )}
        </div>
      </div>
      {atLimit && onUpgrade ? (
        <button
          onClick={onUpgrade}
          className="mt-3 w-full py-2 text-sm text-neon-800 bg-neon-100 dark:bg-transparent dark:text-neon-400 cursor-pointer border-2 border-(--color-border-hard) rounded-full font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down"
        >
          ✦ Unlock with Pro
        </button>
      ) : (
        <button
          onClick={onAdd}
          disabled={isDisabled}
          className={`mt-3 w-full py-2 text-sm ${
            isDisabled
              ? "bg-(--color-surface-raised) text-(--color-text-faint) cursor-not-allowed border-2 border-(--color-border-muted) rounded-full font-bold"
              : "text-neon-800 bg-neon-100 dark:bg-transparent dark:text-neon-400 cursor-pointer border-2 border-(--color-border-hard) rounded-full font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down"
          }`}
        >
          {isAdding
            ? "Adding..."
            : isLive || isTooLong
              ? "Unavailable"
              : addStatus === "queued"
                ? "Queued"
                : addStatus === "processing"
                  ? "Processing..."
                  : "Add to Queue"}
        </button>
      )}
      {addStatus === "error" && addError && <p className="text-red-600 text-xs mt-2">{addError}</p>}
    </li>
  );
}

/** Skeleton placeholder while video info loads, with a reload hint after timeout */
function SkeletonCard({ videoId }: { videoId?: string | null }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStale(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (stale) {
    return (
      <li className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal-sm text-center">
        <p className="text-sm font-bold">Couldn&apos;t detect video</p>
        <p className="text-xs text-(--color-text-faint) mt-1">Try refreshing the YouTube tab</p>
      </li>
    );
  }

  return (
    <li className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal animate-pulse">
      <div className="flex gap-3">
        {videoId ? (
          <img
            src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            className="w-20 h-auto rounded border-2 border-(--color-border-hard) object-cover shrink-0"
          />
        ) : (
          <div className="w-20 h-[45px] rounded border-2 border-(--color-border-muted) bg-(--color-surface-raised) shrink-0" />
        )}
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <div className="h-3.5 bg-(--color-surface-raised) rounded w-3/4" />
          <div className="h-2.5 bg-(--color-surface-raised) rounded w-1/2" />
        </div>
      </div>
      <div className="mt-3 h-8 bg-(--color-surface-raised) rounded-lg w-full" />
    </li>
  );
}
