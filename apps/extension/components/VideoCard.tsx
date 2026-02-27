import type { Summary, VideoInfo } from "@cliphy/shared";

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
  const isDisabled = isAdding || status === "queued" || status === "processing" || isInQueue;

  return (
    <div className="bg-white border-2 border-black rounded-lg p-3 shadow-brutal">
      <div className="flex gap-3">
        {video.videoId && (
          <img
            src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}
            alt=""
            className="w-20 h-auto rounded border-2 border-black object-cover shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug line-clamp-2">{video.title}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
            {video.channel && <span>{video.channel}</span>}
            {video.channel && video.duration && <span>&middot;</span>}
            {video.duration && <span>{video.duration}</span>}
          </div>
        </div>
      </div>
      {isSummarized ? (
        <button
          onClick={onViewExisting}
          className="mt-3 w-full py-2 text-sm bg-green-600 text-white cursor-pointer border-2 border-black rounded-lg font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down flex items-center justify-center gap-1"
        >
          View Summary <span>&rarr;</span>
        </button>
      ) : (
        <button
          onClick={onAdd}
          disabled={isDisabled}
          className={`mt-3 w-full py-2 text-sm ${
            isDisabled
              ? "bg-gray-100 text-gray-400 cursor-not-allowed border-2 border-gray-300 rounded-lg font-bold"
              : "bg-indigo-600 text-white cursor-pointer border-2 border-black rounded-lg font-bold shadow-brutal-sm hover:shadow-brutal-pressed press-down"
          }`}
        >
          {isAdding
            ? "Adding to queue..."
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
