// Voice notes: the parts that are the same on the phone and in a browser,
// and need nothing from either. Saving them is in voiceApi.ts.

/** How long a recording has run, as a clock shows it: "1:05". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Kinds of audio a browser may be able to record, best first. */
const AUDIO_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

/** The first kind of audio this browser can record, or null when it can record none. */
export function pickAudioType(supported: (type: string) => boolean): string | null {
  return AUDIO_TYPES.find((type) => supported(type)) ?? null;
}

/** Where a voice note stands, in a word or the system's own reason. Null once it is ready. */
export function voiceStatus(note: {
  status?: string;
  errorMessage?: string | null;
}): string | null {
  if (note.status === "processing" || note.status === "pending") return "Transcribing";
  if (note.status === "failed") return note.errorMessage?.trim() || "Error";
  return null;
}

export interface Recording {
  /** The audio itself: a Blob in a browser, a file's address on the phone. */
  source: Blob | { uri: string };
  mediaType: string;
  seconds: number;
}
