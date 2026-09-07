import type { Summary } from "@cliphy/shared";
import { QueueCard } from "./QueueCard";
import { WebCard } from "./WebCard";
import { TweetCard } from "./TweetCard";
import { ImageCard } from "./ImageCard";

export function ClipCard({ item, onArchive }: { item: Summary; onArchive?: (id: string) => void }) {
  if (item.sourceType === "tweet") return <TweetCard item={item} onArchive={onArchive} />;
  if (item.sourceType === "web") return <WebCard item={item} onArchive={onArchive} />;
  if (item.sourceType === "image") return <ImageCard item={item} onArchive={onArchive} />;
  return <QueueCard item={item} onArchive={onArchive} />;
}
