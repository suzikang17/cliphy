import {
  fetchTranscript as fetchYoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "@egoist/youtube-transcript-plus";

const MAX_TRANSCRIPT_LENGTH = 100_000;

// Non-speech markers YouTube inserts into auto-generated captions
const NON_SPEECH_PATTERN = /\[.*?\]/g;

// HTML entities that appear in YouTube caption text
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|#\d+);/g;

export class TranscriptNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptNotAvailableError";
  }
}

function decodeHtmlEntities(text: string): string {
  // Run twice to handle double-encoded entities (e.g. &amp;#39; → &#39; → ')
  const decode = (s: string) =>
    s.replace(ENTITY_PATTERN, (match) => {
      if (match.startsWith("&#")) {
        const code = parseInt(match.slice(2, -1), 10);
        return String.fromCharCode(code);
      }
      return NAMED_ENTITIES[match] ?? match;
    });
  return decode(decode(text));
}

export async function fetchTranscript(videoId: string): Promise<string> {
  let result;
  try {
    // Try English first, fall back to any available language
    try {
      result = await fetchYoutubeTranscript(videoId, { lang: "en" });
    } catch {
      result = await fetchYoutubeTranscript(videoId);
    }
  } catch (error) {
    if (
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableError
    ) {
      const detail = error instanceof Error ? ` (${error.name}: ${error.message})` : "";
      throw new TranscriptNotAvailableError(`This video doesn't have captions available.${detail}`);
    }
    if (error instanceof YoutubeTranscriptTooManyRequestError) {
      // Rate limited by YouTube — this IS retryable, let Inngest retry
      throw error;
    }
    if (error instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new TranscriptNotAvailableError("This video is unavailable or private.");
    }
    if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
      throw new TranscriptNotAvailableError("Invalid YouTube video ID.");
    }
    throw error;
  }

  const transcript = result.segments
    .map((s) => decodeHtmlEntities(s.text).replace(NON_SPEECH_PATTERN, "").trim())
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (transcript.length === 0) {
    throw new TranscriptNotAvailableError("Transcript is empty after cleaning.");
  }

  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return transcript;
}
