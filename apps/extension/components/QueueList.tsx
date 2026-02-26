import type { Summary } from "@cliphy/shared";

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onViewAll?: () => void;
}

function ProcessingSpinner() {
  return (
    <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin shrink-0" />
  );
}

function statusTag(status: Summary["status"]) {
  const styles: Record<Summary["status"], string> = {
    completed: "bg-green-100 text-green-800",
    pending: "bg-gray-100 text-gray-600",
    processing: "bg-indigo-100 text-indigo-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${styles[status]}`}>{status}</span>
  );
}

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

const MAX_VISIBLE = 5;

export function QueueList({
  summaries,
  onViewSummary,
  onRemove,
  onRetry,
  onViewAll,
}: QueueListProps) {
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

  const visible = summaries.slice(0, MAX_VISIBLE);
  const remaining = summaries.length - MAX_VISIBLE;

  return (
    <ul className="space-y-2">
      {visible.map((s) => {
        const isClickable = s.status === "completed";
        const isProcessing = s.status === "processing";
        const isFailed = s.status === "failed";
        return (
          <li
            key={s.id}
            onClick={isClickable ? () => onViewSummary(s.id) : undefined}
            className={`flex items-start gap-2 bg-white border-2 border-black rounded-lg px-3 py-2 shadow-brutal-sm ${
              isClickable ? "cursor-pointer hover:shadow-brutal-pressed press-down" : ""
            }`}
          >
            <img
              src={`https://i.ytimg.com/vi/${s.videoId}/default.jpg`}
              alt=""
              className="w-12 h-9 rounded border border-gray-300 object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug truncate">{s.videoTitle ?? s.videoId}</p>
              {s.videoChannel && (
                <p className="text-[10px] text-gray-400 truncate">{s.videoChannel}</p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                {isProcessing ? <ProcessingSpinner /> : statusTag(s.status)}
                <span className="text-[10px] text-gray-400">{timeAgo(s.createdAt)}</span>
                {isFailed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(s.id);
                    }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
            <button
              disabled={isProcessing}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(s.id);
              }}
              className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 p-0 cursor-pointer transition-colors self-center"
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
          </li>
        );
      })}
      {onViewAll && (
        <li>
          <button
            onClick={onViewAll}
            className="w-full text-xs font-bold text-gray-400 hover:text-black py-1.5 cursor-pointer bg-transparent border-0 transition-colors text-center"
          >
            {remaining > 0 ? `View all (${summaries.length})` : "View all"} &rarr;
          </button>
        </li>
      )}
    </ul>
  );
}
