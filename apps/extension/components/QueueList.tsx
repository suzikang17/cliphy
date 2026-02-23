import type { Summary } from "@cliphy/shared";

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
}

function statusTag(status: Summary["status"]) {
  const styles: Record<Summary["status"], string> = {
    completed: "border-green-700 text-green-700",
    pending: "border-gray-500 text-gray-500",
    processing: "border-blue-600 text-blue-600",
    failed: "border-red-600 text-red-600",
  };
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide border px-1.5 py-0.5 ${styles[status]}`}
    >
      {status}
    </span>
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

export function QueueList({ summaries, onViewSummary }: QueueListProps) {
  if (summaries.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-bold">
          No videos queued yet.
        </p>
        <p className="text-xs text-gray-400 mt-1">Visit a YouTube video and click "Add to Queue"</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {summaries.map((s) => {
        const isClickable = s.status === "completed";
        return (
          <li
            key={s.id}
            onClick={isClickable ? () => onViewSummary(s.id) : undefined}
            className={`flex items-start gap-2 border-2 border-black px-3 py-2 ${
              isClickable ? "cursor-pointer hover:bg-gray-100" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-snug truncate">{s.videoTitle ?? s.videoId}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {statusTag(s.status)}
                <span className="text-[10px] text-gray-400">{timeAgo(s.createdAt)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
