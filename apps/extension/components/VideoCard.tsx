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
    <div className="bg-white border-2 border-black rounded-lg p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <p className="text-sm font-bold leading-snug line-clamp-2">{video.title}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
        {video.channel && <span>{video.channel}</span>}
        {video.channel && video.duration && <span>&middot;</span>}
        {video.duration && <span>{video.duration}</span>}
      </div>
      <button
        onClick={onAdd}
        disabled={isDisabled}
        className={`mt-3 w-full py-2 text-sm ${
          isDisabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed border-2 border-gray-300 rounded-lg font-bold"
            : "bg-indigo-600 text-white cursor-pointer border-2 border-black rounded-lg font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
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
