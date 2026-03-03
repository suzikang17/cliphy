import type { Summary, VideoInfo } from "@cliphy/shared";
import { MAX_VIDEO_DURATION_SECONDS, parseDurationToSeconds } from "@cliphy/shared";

interface VideoCardProps {
  video: VideoInfo;
  onAdd: () => void;
  isAdding: boolean;
  status: "idle" | "queued" | "processing" | "error";
  error?: string;
  existingStatus?: Summary["status"];
  onViewExisting?: () => void;
}

export function VideoCard({
  video,
  onAdd,
  isAdding,
  status,
  error,
  existingStatus,
  onViewExisting,
}: VideoCardProps) {
  const isInQueue = existingStatus === "pending" || existingStatus === "processing";
  const isSummarized = existingStatus === "completed";
  const durationSeconds = video.duration ? (parseDurationToSeconds(video.duration) ?? 0) : 0;
  const isTooLong = durationSeconds > MAX_VIDEO_DURATION_SECONDS;
  const isDisabled =
    isAdding || status === "queued" || status === "processing" || isInQueue || isTooLong;

  return (
    <div className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal">
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
          {isTooLong && (
            <p className="text-[10px] text-red-500 mt-1 mb-0">
              Too long to summarize (max 3 hours)
            </p>
          )}
        </div>
      </div>
      {isSummarized ? (
        <button
          onClick={onViewExisting}
          className="mt-3 w-full py-2 text-sm bg-green-600 text-white cursor-pointer border-2 border-(--color-border-hard) rounded-lg font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down flex items-center justify-center gap-1"
        >
          View Summary <span>&rarr;</span>
        </button>
      ) : (
        <button
          onClick={onAdd}
          disabled={isDisabled}
          className={`mt-3 w-full py-2 text-sm ${
            isDisabled
              ? "bg-(--color-surface-raised) text-(--color-text-faint) cursor-not-allowed border-2 border-(--color-border-muted) rounded-lg font-bold"
              : "bg-neon-600 text-white cursor-pointer border-2 border-(--color-border-hard) rounded-lg font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down"
          }`}
        >
          {isAdding
            ? "Adding to queue..."
            : isTooLong
              ? "Too Long"
              : status === "queued" || isInQueue
                ? existingStatus === "processing"
                  ? "Processing..."
                  : "Queued"
                : status === "processing"
                  ? "Processing..."
                  : "Add to Queue"}
        </button>
      )}
      {status === "error" && error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  );
}
