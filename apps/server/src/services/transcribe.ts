// Speech to text. One job: the address of an audio file in, its words out.
//
// Which service does it depends on what is set up:
// - DEEPGRAM_API_KEY: Deepgram's hosted API. It reads the file from its
//   address and answers in the same call, so nothing has to be run by us.
// - WHISPER_SERVICE_URL: a Whisper service of our own, spoken to the way the
//   podcast job already does.
// See docs/decisions/0067 for why hosted is the default.

type Env = Record<string, string | undefined>;

export type TranscribeProvider = "deepgram" | "whisper";

export interface Transcript {
  text: string;
  /** How long the recording is, when the service says. */
  seconds: number | null;
}

interface Options {
  env?: Env;
  fetch?: typeof globalThis.fetch;
  /** Give up after this long. Voice notes are short; a podcast is not. */
  timeoutMs?: number;
}

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
/** Deepgram's general-purpose model. DEEPGRAM_MODEL overrides it. */
const DEEPGRAM_MODEL = "nova-3";

const set = (value: string | undefined): string | null => value?.trim() || null;

/** The service that will be used, or null when none is set up. */
export function pickProvider(env: Env = process.env): TranscribeProvider | null {
  if (set(env.DEEPGRAM_API_KEY)) return "deepgram";
  if (set(env.WHISPER_SERVICE_URL)) return "whisper";
  return null;
}

/** Why a service refused, in its own words when it gave any. */
async function refusal(name: string, res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let said = raw.slice(0, 200);
  try {
    const parsed = JSON.parse(raw) as { err_msg?: string; error?: string; message?: string };
    said = parsed.err_msg ?? parsed.error ?? parsed.message ?? said;
  } catch {
    // Not JSON: the text itself is the reason.
  }
  return new Error(`${name} ${res.status}: ${said}`.trim());
}

export async function transcribeAudio(audioUrl: string, opts: Options = {}): Promise<Transcript> {
  const env = opts.env ?? process.env;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const provider = pickProvider(env);
  if (!provider) throw new Error("Transcription is not set up");
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000);

  let text: string;
  let seconds: number | null = null;

  if (provider === "deepgram") {
    const model = set(env.DEEPGRAM_MODEL) ?? DEEPGRAM_MODEL;
    const res = await fetcher(
      `${DEEPGRAM_URL}?model=${encodeURIComponent(model)}&smart_format=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${set(env.DEEPGRAM_API_KEY)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: audioUrl }),
        signal,
      },
    );
    if (!res.ok) throw await refusal("Deepgram", res);
    const data = (await res.json()) as {
      metadata?: { duration?: number };
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    };
    text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    seconds = typeof data.metadata?.duration === "number" ? data.metadata.duration : null;
  } else {
    const base = (set(env.WHISPER_SERVICE_URL) as string).replace(/\/+$/, "");
    const res = await fetcher(`${base}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": env.WHISPER_API_KEY ?? "" },
      body: JSON.stringify({ audio_url: audioUrl }),
      signal,
    });
    if (!res.ok) throw await refusal("Whisper", res);
    const data = (await res.json()) as { transcript?: string; text?: string };
    text = data.transcript ?? data.text ?? "";
  }

  if (!text.trim()) throw new Error("No speech found in the recording");
  return { text: text.trim(), seconds };
}

// ── Start, then check ────────────────────────────────────────────────────
// A serverless function is cut off after a minute, and a Whisper service of
// our own can take longer than that on a busy machine. So the job behind a
// voice note does not wait on one call: it starts the transcription, then
// asks how it is going until it is done. Deepgram answers in the first call.

/** Either the finished transcript, or the id of a job to check on. */
export type Started = { done: Transcript } | { jobId: string };

export async function startTranscription(audioUrl: string, opts: Options = {}): Promise<Started> {
  const env = opts.env ?? process.env;
  if (pickProvider(env) !== "whisper") return { done: await transcribeAudio(audioUrl, opts) };

  const fetcher = opts.fetch ?? globalThis.fetch;
  const base = (set(env.WHISPER_SERVICE_URL) as string).replace(/\/+$/, "");
  const res = await fetcher(`${base}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": env.WHISPER_API_KEY ?? "" },
    body: JSON.stringify({ audio_url: audioUrl }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw await refusal("Whisper", res);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Whisper gave no job id");
  return { jobId: data.id };
}

/** The transcript of a started job, or null while it is still being worked on. */
export async function checkTranscription(
  jobId: string,
  opts: Options = {},
): Promise<Transcript | null> {
  const env = opts.env ?? process.env;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const base = (set(env.WHISPER_SERVICE_URL) ?? "").replace(/\/+$/, "");
  const res = await fetcher(`${base}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { "X-API-Key": env.WHISPER_API_KEY ?? "" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw await refusal("Whisper", res);
  const job = (await res.json()) as {
    status?: string;
    transcript?: string;
    duration_seconds?: number;
    error?: string;
  };
  if (job.status === "failed") throw new Error(job.error?.trim() || "Whisper job failed");
  if (job.status !== "done") return null;
  const text = (job.transcript ?? "").trim();
  if (!text) throw new Error("No speech found in the recording");
  return { text, seconds: typeof job.duration_seconds === "number" ? job.duration_seconds : null };
}
