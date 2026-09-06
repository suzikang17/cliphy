import type { Summary, WebClipMetadata } from "../../types";
import { sourceGlyph } from "../../clipGlyph";
import { CARD_SHELL, CARD_MEDIA, CARD_TITLE, CARD_META, CARD_BODY } from "./cardShell";

export interface CardProps {
  item: Summary;
  /** The host decides navigation — the extension and the web app route differently. */
  onOpen?: (clip: Summary) => void;
}

export function WebCard({ item, onOpen }: CardProps) {
  const meta = (item.sourceMetadata ?? {}) as unknown as WebClipMetadata;

  return (
    <button type="button" onClick={() => onOpen?.(item)} className={CARD_SHELL}>
      {item.heroImageUrl ? (
        <img
          src={item.heroImageUrl}
          alt=""
          loading="lazy"
          className={`${CARD_MEDIA} mb-2 aspect-[16/10]`}
        />
      ) : null}
      <p className={`${CARD_TITLE} line-clamp-2`}>{item.videoTitle ?? item.sourceUrl}</p>
      <p className={`${CARD_META} mt-0.5 line-clamp-1`}>
        {sourceGlyph(item.sourceType)} {meta.siteName ?? "Link"}
        {meta.readingTimeMin ? ` · ${meta.readingTimeMin} min read` : ""}
      </p>
      {item.excerpt ? <p className={`${CARD_BODY} mt-1 line-clamp-2`}>{item.excerpt}</p> : null}
    </button>
  );
}
