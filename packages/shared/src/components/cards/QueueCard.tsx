import { sourceGlyph } from "../../clipGlyph";
import { CARD_SHELL, CARD_MEDIA, CARD_TITLE, CARD_META } from "./cardShell";
import type { CardProps } from "./WebCard";

const STATUS_COLOR: Record<string, string> = {
  pending: "#6b7280",
  processing: "#c4f000",
  completed: "#16a34a",
  failed: "#dc2626",
};

/** YouTube and podcast clips. Carries the queue status dot for in-flight work. */
export function QueueCard({ item, onOpen }: CardProps) {
  const processing = item.status === "processing";
  const dotColor = STATUS_COLOR[item.status] ?? STATUS_COLOR.pending;
  const thumb = item.videoId
    ? `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`
    : item.heroImageUrl;

  return (
    <button type="button" onClick={() => onOpen?.(item)} className={CARD_SHELL}>
      {thumb ? (
        <div className="relative">
          <img src={thumb} alt="" loading="lazy" className={`${CARD_MEDIA} mb-2 aspect-video`} />
          {/* Status dot, ringed in the card background so it reads on any frame. */}
          <span
            aria-hidden
            className={`absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-[#f9fafb] dark:border-[#282828] ${
              processing ? "animate-pulse" : ""
            }`}
            style={{ backgroundColor: dotColor }}
          />
        </div>
      ) : null}
      <p className={`${CARD_META} mb-0.5`}>
        {sourceGlyph(item.sourceType)} {item.videoChannel || item.author || "YouTube"}
      </p>
      <p className={`${CARD_TITLE} line-clamp-3`}>
        {item.videoTitle || (item.videoId ? `Video ${item.videoId}` : "Clip")}
      </p>
    </button>
  );
}
