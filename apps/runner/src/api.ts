import type { RunBrief, RunOutcome } from "./contract.js";
import type { RunnerConfig } from "./machine.js";
import type { RunDeps } from "./run.js";

/** The three calls, and the upload of a picture. This is all the runner's key can do. */
export function createApi(config: Pick<RunnerConfig, "apiUrl" | "apiKey">): RunDeps["api"] {
  const base = `${config.apiUrl.replace(/\/+$/, "")}/api/coach`;

  async function call<T>(route: string, body: unknown = {}): Promise<T> {
    const res = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`POST ${route} → ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  return {
    claim: async () => {
      const { run, brief } = await call<{ run: { id: string } | null; brief?: RunBrief }>(
        "/runs/claim",
      );
      return run && brief ? { run, brief } : null;
    },
    checkIn: (runId, note) => call<{ cancelled: boolean }>(`/runs/${runId}/checkin`, { note }),
    finish: async (runId: string, outcome: RunOutcome) => {
      await call(`/runs/${runId}/finish`, outcome);
    },
    upload: async (bytes, mediaType) => {
      const { path, signedUrl } = await call<{ path: string; signedUrl: string }>(
        "/intake/upload-url",
        { mediaType },
      );
      // The signed address carries its own token; the API key is not sent to storage.
      const res = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": mediaType },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Upload → ${res.status}`);
      return path;
    },
  };
}
