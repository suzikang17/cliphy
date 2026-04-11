import type { Summary } from "@cliphy/shared";
import { formatTimeSaved, relativeDate } from "@cliphy/shared";
import { Link } from "react-router";

interface SummaryCardProps {
  summary: Summary;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  processing: "Generating...",
  failed: "Failed",
};

export function SummaryCard({ summary }: SummaryCardProps) {
  const isReady = summary.status === "completed" && summary.summaryJson;
  const statusLabel = STATUS_LABELS[summary.status];

  return (
    <Link
      to={isReady ? `/summary/${summary.id}` : "#"}
      className={`block border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm bg-(--color-surface) hover:shadow-brutal-hover press-down transition-all no-underline text-(--color-text) ${
        !isReady ? "opacity-70 pointer-events-none" : ""
      }`}
    >
      <div className="flex gap-4 p-4">
        {/* Thumbnail */}
        <img
          src={`https://i.ytimg.com/vi/${summary.videoId}/mqdefault.jpg`}
          alt=""
          className="w-32 h-20 rounded-md border-2 border-(--color-border-hard) object-cover shrink-0"
        />

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-snug m-0 line-clamp-2">
            {summary.videoTitle || summary.videoId}
          </h3>

          <div className="flex items-center gap-2 text-xs text-(--color-text-muted) mt-1">
            {summary.videoChannel && <span>{summary.videoChannel}</span>}
            {summary.videoDurationSeconds != null && summary.videoDurationSeconds > 0 && (
              <>
                <span>&middot;</span>
                <span>{formatTimeSaved(summary.videoDurationSeconds)}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{relativeDate(summary.createdAt)}</span>
          </div>

          {statusLabel && (
            <span
              className={`inline-block mt-2 text-xs font-bold px-2 py-0.5 rounded-full border-2 ${
                summary.status === "failed"
                  ? "bg-(--color-error-surface) border-red-300 text-red-600"
                  : "bg-neon-100 border-neon-300 text-neon-700"
              }`}
            >
              {summary.status === "processing" && (
                <span className="inline-block w-2.5 h-2.5 border-2 border-neon-500 border-t-transparent rounded-full animate-spin mr-1 align-middle" />
              )}
              {statusLabel}
            </span>
          )}

          {isReady && summary.summaryJson && (
            <p className="text-xs text-(--color-text-secondary) mt-2 m-0 line-clamp-2 leading-relaxed">
              {summary.summaryJson.summary}
            </p>
          )}

          {summary.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {summary.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-soft)"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
