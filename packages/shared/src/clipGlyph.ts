import type { SourceType } from "./types";

const GLYPHS: Record<SourceType, string> = {
  youtube: "▶",
  web: "🔗",
  tweet: "🐦",
  podcast: "🎧",
  image: "🖼",
  note: "✎",
  voice: "🎙",
};

export function sourceGlyph(t: SourceType): string {
  return GLYPHS[t] ?? "";
}
