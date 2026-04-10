import * as Clipboard from "expo-clipboard";

const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;

export async function getYouTubeUrlFromClipboard(): Promise<string | null> {
  try {
    const hasString = await Clipboard.hasStringAsync();
    if (!hasString) return null;

    const text = await Clipboard.getStringAsync();
    const match = text.match(YOUTUBE_REGEX);
    if (!match) return null;

    return `https://www.youtube.com/watch?v=${match[1]}`;
  } catch {
    return null;
  }
}
