import type { VideoInfo } from "@cliphy/shared";

interface VideoCardProps {
  video: VideoInfo;
  onAdd: () => void;
  isAdding: boolean;
  status: "idle" | "queued" | "processing" | "error";
  error?: string;
}

export function VideoCard({ video, onAdd, isAdding, status, error }: VideoCardProps) {
  const isDisabled = isAdding || status === "queued" || status === "processing";

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <p className="text-sm font-medium leading-snug line-clamp-2">{video.title}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        {video.channel && <span>{video.channel}</span>}
        {video.channel && video.duration && <span>·</span>}
        {video.duration && <span>{video.duration}</span>}
      </div>
      <button
        onClick={onAdd}
        disabled={isDisabled}
        className={`mt-3 w-full py-2 text-sm rounded font-medium ${
          isDisabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white cursor-pointer hover:bg-blue-700"
        }`}
      >
        {isAdding
          ? "Adding..."
          : status === "queued"
            ? "Queued"
            : status === "processing"
              ? "Processing..."
              : "Add to Queue"}
      </button>
      {status === "error" && error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  );
}
