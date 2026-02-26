/**
 * Extract YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://youtube.com/v/VIDEO_ID
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace("www.", "");

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      // /watch?v=VIDEO_ID
      const vParam = parsed.searchParams.get("v");
      if (vParam) return vParam;

      // /embed/VIDEO_ID, /v/VIDEO_ID, /shorts/VIDEO_ID
      const pathMatch = parsed.pathname.match(/^\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[2];

      return null;
    }

    if (hostname === "youtu.be") {
      const id = parsed.pathname.slice(1); // remove leading /
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a YouTube duration string (e.g. "12:34", "1:23:45") to total seconds.
 * Returns null if the format is unrecognized.
 */
export function parseDurationToSeconds(duration: string): number | null {
  const parts = duration.split(":").map(Number);
  if (parts.some(isNaN)) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

/** Format a duration in seconds to a human-readable string (e.g. "12m", "1h 23m", "45s"). */
export function formatTimeSaved(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
