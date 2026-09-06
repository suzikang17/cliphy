import type { TweetClipMetadata } from "../../types";
import { CARD_SHELL, CARD_MEDIA, CARD_META } from "./cardShell";
import type { CardProps } from "./WebCard";

export function TweetCard({ item, onOpen }: CardProps) {
  const meta = (item.sourceMetadata ?? {}) as unknown as TweetClipMetadata;
  const threadCount = meta.threadTweetIds?.length ?? 1;
  const preview = meta.media?.[0]?.previewUrl;

  return (
    <button type="button" onClick={() => onOpen?.(item)} className={CARD_SHELL}>
      <div className="mb-1 flex items-center gap-2">
        {meta.avatarUrl ? (
          <img
            src={meta.avatarUrl}
            alt=""
            loading="lazy"
            className="h-8 w-8 rounded-full border border-black dark:border-[#505050]"
          />
        ) : null}
        <span className="line-clamp-1 text-sm font-bold text-[#111827] dark:text-white">
          @{meta.handle}
        </span>
        {threadCount > 1 ? <span className={CARD_META}>🧵 {threadCount}</span> : null}
      </div>
      <p className="line-clamp-5 text-sm text-[#111827] dark:text-white">{item.content}</p>
      {preview ? (
        <img src={preview} alt="" loading="lazy" className={`${CARD_MEDIA} mt-2 aspect-[4/3]`} />
      ) : null}
    </button>
  );
}
