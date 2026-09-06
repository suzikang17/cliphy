import type { Summary } from "@cliphy/shared";
import { QueueCard } from "./QueueCard";
import { WebCard } from "./WebCard";
import { TweetCard } from "./TweetCard";
import { ImageCard } from "./ImageCard";

export function ClipCard({ item }: { item: Summary }) {
  if (item.sourceType === "tweet") return <TweetCard item={item} />;
  if (item.sourceType === "web") return <WebCard item={item} />;
  if (item.sourceType === "image") return <ImageCard item={item} />;
  return <QueueCard item={item} />;
}
