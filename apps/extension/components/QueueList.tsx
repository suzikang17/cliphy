import type { Summary } from "@cliphy/shared";

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
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

export function QueueList({ summaries, onViewSummary }: QueueListProps) {
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

  return (
    <ul className="space-y-2">
      {summaries.map((s) => {
        const isClickable = s.status === "completed";
        return (
          <li
            key={s.id}
            onClick={isClickable ? () => onViewSummary(s.id) : undefined}
            className={`flex items-start gap-2 bg-white border-2 border-black rounded-lg px-3 py-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${
              isClickable
                ? "cursor-pointer hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug truncate">{s.videoTitle ?? s.videoId}</p>
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
