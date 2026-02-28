import { fetchViaProxy } from "../lib/proxy.js";

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

const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const ANDROID_CLIENT_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    hl: "en",
  },
};

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

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

interface PlayerResponse {
  playabilityStatus?: { status: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

/** Fetch caption tracks via InnerTube Player API (ANDROID client, no auth needed). */
async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const res = await fetchViaProxy(INNERTUBE_PLAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: ANDROID_CLIENT_CONTEXT,
      videoId,
    }),
  });

  if (!res.ok) {
    throw new Error(`InnerTube player API returned ${res.status}`);
  }

  const data = (await res.json()) as PlayerResponse;

  console.log(
    `[transcript] videoId=${videoId} status=${data.playabilityStatus?.status} hasCaptions=${!!data.captions} tracks=${data.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0} proxy=${!!process.env.PROXY_URL}`,
  );

  if (data.playabilityStatus?.status === "ERROR") {
    throw new TranscriptNotAvailableError("This video is unavailable or private.");
  }

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    throw new TranscriptNotAvailableError("This video doesn't have captions available.");
  }

  return tracks;
}

/** Pick the best caption track: prefer English, fallback to first available. */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return tracks.find((t) => t.languageCode === "en") ?? tracks[0];
}

/** Fetch and parse timedtext XML (srv3 format: <p> tags with <s> children). */
async function fetchTimedText(track: CaptionTrack): Promise<string[]> {
  const url = `${track.baseUrl}&fmt=srv1`;
  const res = await fetchViaProxy(url);

  if (!res.ok) {
    throw new Error(`Timedtext fetch failed: ${res.status}`);
  }

  const xml = await res.text();

  // YouTube returns srv3 regardless of fmt param.
  // srv3 format: <p t="ms" d="ms"><s>text</s><s>text</s></p>
  // Also handle srv1 format: <text start="s" dur="s">text</text>
  const segments: string[] = [];

  // Try srv3 format first (<p> with <s> children)
  const pTags = xml.match(/<p [^>]*>[\s\S]*?<\/p>/g);
  if (pTags) {
    for (const p of pTags) {
      const sTags = p.match(/<s[^>]*>([\s\S]*?)<\/s>/g);
      if (sTags) {
        const text = sTags.map((s) => s.replace(/<\/?s[^>]*>/g, "")).join("");
        if (text.trim()) segments.push(text.trim());
      } else {
        // <p> without <s> children — text is directly inside
        const inner = p.replace(/<\/?p[^>]*>/g, "").trim();
        if (inner) segments.push(inner);
      }
    }
  }

  // Fallback: srv1 format (<text> tags)
  if (segments.length === 0) {
    const textTags = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
    if (textTags) {
      for (const tag of textTags) {
        const inner = tag.replace(/<\/?text[^>]*>/g, "").trim();
        if (inner) segments.push(inner);
      }
    }
  }

  return segments;
}

// Zero-width and invisible Unicode characters used in prompt injection
// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

// Prompt injection patterns — case-insensitive, matches common attack vectors
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above\s+instructions/gi,
  /disregard\s+(all\s+)?previous/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+instructions?:/gi,
  /^system\s*:/gim,
  /^assistant\s*:/gim,
  /^user\s*:/gim,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
];

/** Strip prompt injection patterns and invisible characters from transcript text. */
function sanitizeTranscript(text: string): string {
  let cleaned = text.replace(ZERO_WIDTH_CHARS, "");
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

export async function fetchTranscript(videoId: string): Promise<string> {
  const tracks = await fetchCaptionTracks(videoId);
  const track = pickTrack(tracks);
  const segments = await fetchTimedText(track);

  let transcript = segments
    .map((s) => decodeHtmlEntities(s).replace(NON_SPEECH_PATTERN, "").trim())
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (transcript.length === 0) {
    throw new TranscriptNotAvailableError("Transcript is empty after cleaning.");
  }

  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return sanitizeTranscript(transcript);
}
