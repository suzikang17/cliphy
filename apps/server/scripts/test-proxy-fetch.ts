/**
 * Stress-test the real backend YouTube transcript fetch through the rotating proxy.
 *
 * Exercises the exact production path (fetchTranscript -> fetchCaptionTracks ->
 * fetchViaProxy, InnerTube ANDROID client) so we can measure proxy reliability and
 * reproduce the intermittent connect timeouts.
 *
 * Usage:
 *   pnpm test-proxy [videoId] [runs] [concurrency]
 *   pnpm test-proxy dQw4w9WgXcQ 20 3
 *
 * Reads PROXY_URL from apps/server/.env.local. With no PROXY_URL set it tests the
 * direct (no-proxy) path instead — useful as a control.
 */
import { fetchTranscript, TranscriptNotAvailableError } from "../src/services/transcript.js";

const videoId = process.argv[2] || "dQw4w9WgXcQ"; // default: a video that has captions
const runs = Number(process.argv[3] || 10);
const concurrency = Number(process.argv[4] || 1);

type Outcome = "ok" | "no_captions" | "proxy_error" | "other_error";

interface Result {
  outcome: Outcome;
  ms: number;
  detail?: string;
}

function classify(err: unknown): { outcome: Outcome; detail: string } {
  if (err instanceof TranscriptNotAvailableError) {
    return { outcome: "no_captions", detail: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/via proxy|connect timeout|timeout|econn|enotfound|fetch failed|network request/i.test(msg)) {
    return { outcome: "proxy_error", detail: msg };
  }
  return { outcome: "other_error", detail: msg };
}

async function once(i: number): Promise<Result> {
  const start = performance.now();
  try {
    const res = await fetchTranscript(videoId);
    const ms = performance.now() - start;
    console.log(
      `#${i} ok            ${ms.toFixed(0)}ms  (${res.text.length} chars, lang=${res.language})`,
    );
    return { outcome: "ok", ms };
  } catch (err) {
    const ms = performance.now() - start;
    const { outcome, detail } = classify(err);
    console.log(`#${i} ${outcome.padEnd(13)} ${ms.toFixed(0)}ms  ${detail}`);
    return { outcome, ms, detail };
  }
}

async function runPool(): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  async function worker() {
    while (next < runs) {
      const i = next++;
      results[i] = await once(i + 1);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, worker));
  return results;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

(async () => {
  console.log(
    `\nTesting fetchTranscript(${videoId})  runs=${runs} concurrency=${concurrency}  ` +
      `proxy=${process.env.PROXY_URL ? "ON" : "OFF (direct)"}\n`,
  );

  const results = await runPool();

  const by = (o: Outcome) => results.filter((r) => r.outcome === o);
  const ok = by("ok");
  const noCaps = by("no_captions");
  const proxyErr = by("proxy_error");
  const otherErr = by("other_error");

  // "proxy reachable" = anything that got a real response from YouTube (ok or no_captions)
  const reachable = ok.length + noCaps.length;
  const latencies = [...ok, ...noCaps].map((r) => r.ms).sort((a, b) => a - b);

  console.log("\n──────── summary ────────");
  console.log(`ok           : ${ok.length}/${runs}`);
  console.log(`no_captions  : ${noCaps.length}/${runs}  (proxy worked, video lacks captions)`);
  console.log(`proxy_error  : ${proxyErr.length}/${runs}  ← the failure we're chasing`);
  console.log(`other_error  : ${otherErr.length}/${runs}`);
  console.log(
    `proxy reachable rate: ${((reachable / runs) * 100).toFixed(0)}%  ` +
      `(${reachable}/${runs} connected to YouTube)`,
  );
  if (latencies.length) {
    console.log(
      `latency (reachable): min ${pct(latencies, 0).toFixed(0)}ms  ` +
        `p50 ${pct(latencies, 50).toFixed(0)}ms  ` +
        `p95 ${pct(latencies, 95).toFixed(0)}ms  ` +
        `max ${latencies[latencies.length - 1].toFixed(0)}ms`,
    );
  }
  console.log("─────────────────────────\n");
})();
