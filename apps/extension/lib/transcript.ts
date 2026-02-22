/**
 * Lightweight YouTube transcript fetcher for the browser/extension context.
 * Runs from the user's IP (not a datacenter), avoiding YouTube's bot blocking.
 */

const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
const MAX_TRANSCRIPT_LENGTH = 100_000;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|#\d+);/g;

function decodeHtmlEntities(text: string): string {
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

export class TranscriptFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptFetchError";
  }
}

/**
 * Fetch the transcript for a YouTube video.
 * Uses the Innertube player API (same approach as server library)
 * but runs from the browser so it won't be blocked by YouTube.
 */
export async function fetchTranscript(videoId: string): Promise<string> {
  // Step 1: Fetch the YouTube watch page to get the API key
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "Accept-Language": "en" },
  });

  if (!watchRes.ok) {
    throw new TranscriptFetchError(`YouTube page returned ${watchRes.status}`);
  }

  const html = await watchRes.text();

  if (html.includes('class="g-recaptcha"')) {
    throw new TranscriptFetchError("YouTube is showing a CAPTCHA");
  }

  const apiKeyMatch =
    html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ||
    html.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);

  if (!apiKeyMatch) {
    throw new TranscriptFetchError("Could not extract YouTube API key");
  }

  // Step 2: Call the Innertube player API to get caption tracks
  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKeyMatch[1]}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: { clientName: "WEB", clientVersion: "2.20240101.00.00" },
        },
        videoId,
      }),
    },
  );

  if (!playerRes.ok) {
    throw new TranscriptFetchError(`Player API returned ${playerRes.status}`);
  }

  const player = await playerRes.json();
  const tracklist =
    player?.captions?.playerCaptionsTracklistRenderer ?? player?.playerCaptionsTracklistRenderer;
  const tracks = tracklist?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new TranscriptFetchError("No caption tracks available");
  }

  // Prefer English, fall back to first available
  const track = tracks.find((t: { languageCode: string }) => t.languageCode === "en") ?? tracks[0];
  const transcriptUrl: string | undefined = track.baseUrl || track.url;

  if (!transcriptUrl) {
    throw new TranscriptFetchError("No transcript URL in caption track");
  }

  // Step 3: Fetch and parse the transcript XML
  const transcriptRes = await fetch(transcriptUrl);
  if (!transcriptRes.ok) {
    throw new TranscriptFetchError(`Transcript fetch returned ${transcriptRes.status}`);
  }

  const xml = await transcriptRes.text();
  const segments = [...xml.matchAll(RE_XML_TRANSCRIPT)].map((m) => m[3]);

  if (segments.length === 0) {
    throw new TranscriptFetchError("Transcript has no segments");
  }

  // Clean up: decode entities, remove non-speech markers, join
  const transcript = segments
    .map((text) =>
      decodeHtmlEntities(text)
        .replace(/\[.*?\]/g, "")
        .trim(),
    )
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (transcript.length === 0) {
    throw new TranscriptFetchError("Transcript is empty after cleaning");
  }

  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return transcript;
}
