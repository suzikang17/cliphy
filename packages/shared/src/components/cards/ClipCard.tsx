import type { Summary } from "../../types";
import { WebCard, type CardProps } from "./WebCard";
import { TweetCard } from "./TweetCard";
import { ImageCard } from "./ImageCard";
import { QueueCard } from "./QueueCard";

/**
 * DOM twin of apps/mobile/components/ClipCard.tsx — same dispatch, same four
 * cards. Keep the two in step: a new source type needs a branch in both.
 */
export function ClipCard({ item, onOpen }: CardProps) {
  if (item.sourceType === "tweet") return <TweetCard item={item} onOpen={onOpen} />;
  if (item.sourceType === "web") return <WebCard item={item} onOpen={onOpen} />;
  if (item.sourceType === "image") return <ImageCard item={item} onOpen={onOpen} />;
  return <QueueCard item={item} onOpen={onOpen} />;
}

export type { Summary, CardProps };
