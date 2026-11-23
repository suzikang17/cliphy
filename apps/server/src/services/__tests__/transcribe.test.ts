import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { pickProvider, transcribeAudio } from "../transcribe.js";

// Speech to text for voice notes. One job: an address of an audio file in,
// its words out. Which service does it is chosen by what is set up.

const audio = "https://storage.example/voice/u1/a.m4a?token=x";

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

beforeEach(async () => {
  await layer("unit");
  await epic("Library");
  await feature("Voice notes");
});

describe("pickProvider", () => {
  it("uses Deepgram when it has a key, else a Whisper service, else nothing", () => {
    expect(pickProvider({ DEEPGRAM_API_KEY: "k", WHISPER_SERVICE_URL: "https://w" })).toBe(
      "deepgram",
    );
    expect(pickProvider({ WHISPER_SERVICE_URL: "https://w" })).toBe("whisper");
    expect(pickProvider({})).toBeNull();
    expect(pickProvider({ DEEPGRAM_API_KEY: "  " })).toBeNull();
  });
});

describe("transcribeAudio", () => {
  it("sends Deepgram the file's address and reads the words and the length back", async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        metadata: { duration: 12.4 },
        results: { channels: [{ alternatives: [{ transcript: "Move the photo down. " }] }] },
      },
    });
    const out = await transcribeAudio(audio, { env: { DEEPGRAM_API_KEY: "k" }, fetch });
    expect(out).toEqual({ text: "Move the photo down.", seconds: 12.4 });
    expect(calls[0].url).toBe("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Token k");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ url: audio });
  });

  it("lets the model be changed without a deploy of new code", async () => {
    const { fetch, calls } = fakeFetch({
      body: { results: { channels: [{ alternatives: [{ transcript: "hi" }] }] } },
    });
    await transcribeAudio(audio, {
      env: { DEEPGRAM_API_KEY: "k", DEEPGRAM_MODEL: "nova-9" },
      fetch,
    });
    expect(calls[0].url).toContain("model=nova-9");
  });

  it("talks to a Whisper service the way the podcast job does", async () => {
    const { fetch, calls } = fakeFetch({ body: { text: "hello there" } });
    const out = await transcribeAudio(audio, {
      env: { WHISPER_SERVICE_URL: "https://w.example/", WHISPER_API_KEY: "wk" },
      fetch,
    });
    expect(out).toEqual({ text: "hello there", seconds: null });
    expect(calls[0].url).toBe("https://w.example/transcribe");
    expect((calls[0].init.headers as Record<string, string>)["X-API-Key"]).toBe("wk");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ audio_url: audio });
  });

  it("fails in the service's own words, and says so when nothing was heard or nothing is set up", async () => {
    const refused = fakeFetch({ status: 401, body: { err_msg: "Invalid credentials." } });
    await expect(
      transcribeAudio(audio, { env: { DEEPGRAM_API_KEY: "k" }, fetch: refused.fetch }),
    ).rejects.toThrow("Deepgram 401: Invalid credentials.");

    const silent = fakeFetch({
      body: { results: { channels: [{ alternatives: [{ transcript: "  " }] }] } },
    });
    await expect(
      transcribeAudio(audio, { env: { DEEPGRAM_API_KEY: "k" }, fetch: silent.fetch }),
    ).rejects.toThrow("No speech found in the recording");

    await expect(transcribeAudio(audio, { env: {} })).rejects.toThrow(
      "Transcription is not set up",
    );
  });
});
