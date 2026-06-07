import { Hono } from "hono";
import { fetchTranscript, TranscriptNotAvailableError } from "../../services/transcript.js";

// Debug endpoint (admin-protected): runs the real transcript fetch path through the
// proxy *from the server*, so we can reproduce/measure the Vercel -> Decodo behavior
// that local testing can't (concurrency limits, datacenter-source throttling).
//
//   GET /api/admin/proxy-test?videoId=dQw4w9WgXcQ&runs=8&concurrency=5
export const adminProxyTestRoutes = new Hono();

type Outcome = "ok" | "no_captions" | "proxy_error" | "other_error";

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

adminProxyTestRoutes.get("/", async (c) => {
  const videoId = c.req.query("videoId") || "dQw4w9WgXcQ";
  const runs = Math.min(Math.max(Number(c.req.query("runs") || 5), 1), 20);
  const concurrency = Math.min(Math.max(Number(c.req.query("concurrency") || 3), 1), 10);

  const results: { i: number; outcome: Outcome; ms: number; detail?: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < runs) {
      const i = next++;
      const start = Date.now();
      try {
        const res = await fetchTranscript(videoId);
        results[i] = {
          i,
          outcome: "ok",
          ms: Date.now() - start,
          detail: `${res.text.length} chars`,
        };
      } catch (err) {
        const { outcome, detail } = classify(err);
        results[i] = { i, outcome, ms: Date.now() - start, detail };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, worker));

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const reachableResults = results.filter((r) => r.outcome === "ok" || r.outcome === "no_captions");
  const lat = reachableResults.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) =>
    lat.length ? lat[Math.min(lat.length - 1, Math.floor((q / 100) * lat.length))] : 0;

  return c.json({
    videoId,
    runs,
    concurrency,
    proxy: process.env.PROXY_URL ? "on" : "off",
    region: process.env.VERCEL_REGION ?? null,
    summary: {
      ok: count("ok"),
      no_captions: count("no_captions"),
      proxy_error: count("proxy_error"),
      other_error: count("other_error"),
      reachableRate: `${Math.round((reachableResults.length / runs) * 100)}%`,
      latencyMs: { min: p(0), p50: p(50), p95: p(95), max: lat[lat.length - 1] ?? 0 },
    },
    results: results.sort((a, b) => a.i - b.i),
  });
});
