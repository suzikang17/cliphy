import type { ImageClipMetadata } from "../../types";
import { CARD_SHELL, CARD_MEDIA, CARD_META } from "./cardShell";
import type { CardProps } from "./WebCard";

export function ImageCard({ item, onOpen }: CardProps) {
  const meta = (item.sourceMetadata ?? {}) as unknown as ImageClipMetadata;
  const processing = item.status === "pending" || item.status === "processing";

  return (
    <button type="button" onClick={() => onOpen?.(item)} className={CARD_SHELL}>
      {item.heroImageUrl ? (
        <img
          src={item.heroImageUrl}
          alt=""
          loading="lazy"
          className={`${CARD_MEDIA} mb-2 aspect-[3/4]`}
        />
      ) : null}
      {meta.tweet ? <p className={`${CARD_META} mb-1`}>🐦 @{meta.tweet.handle}</p> : null}
      <p className="line-clamp-3 text-sm text-[#111827] dark:text-white">
        {processing ? "Processing…" : (item.excerpt ?? item.content ?? "Image")}
      </p>
    </button>
  );
}
