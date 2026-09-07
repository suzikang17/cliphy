import type { SourceType } from "./types";

const GLYPHS: Record<SourceType, string> = {
  youtube: "▶",
  web: "🔗",
  tweet: "🐦",
  podcast: "🎧",
  image: "🖼",
  note: "✎",
};

export function sourceGlyph(t: SourceType): string {
  return GLYPHS[t] ?? "";
}
