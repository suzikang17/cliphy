import type { Summary } from "@cliphy/shared";

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
}

function statusIcon(status: Summary["status"]): string {
  switch (status) {
    case "completed":
      return "\u2705";
    case "pending":
    case "processing":
      return "\u23F3";
    case "failed":
      return "\u274C";
  }
}

export function QueueList({ summaries, onViewSummary }: QueueListProps) {
  if (summaries.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No videos queued yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {summaries.map((s) => {
        const isClickable = s.status === "completed";
        return (
          <li
            key={s.id}
            onClick={isClickable ? () => onViewSummary(s.id) : undefined}
            className={`flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 ${
              isClickable ? "cursor-pointer hover:bg-gray-50" : ""
            }`}
          >
            <span className="shrink-0 mt-0.5">{statusIcon(s.status)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug truncate">{s.videoTitle ?? s.videoId}</p>
              <p className="text-xs text-gray-400 capitalize">{s.status}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
