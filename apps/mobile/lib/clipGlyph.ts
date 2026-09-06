import type { SourceType } from "@cliphy/shared";

const GLYPHS: Record<SourceType, string> = {
  youtube: "▶",
  web: "🔗",
  tweet: "🐦",
  podcast: "🎧",
  image: "🖼",
};

export function sourceGlyph(t: SourceType): string {
  return GLYPHS[t] ?? "";
}
