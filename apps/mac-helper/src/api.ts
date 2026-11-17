import type { CapturedPerson, IntakeMessage } from "./plan.js";
import type { HelperConfig } from "./store.js";
import { ApiError, type SyncDeps } from "./sync.js";

/** The coach API as the sync cycle needs it. Any refusal throws, so a cursor is never moved past it. */
export function createApi(config: HelperConfig): SyncDeps["api"] {
  const base = `${config.apiUrl.replace(/\/+$/, "")}/api/coach`;

  async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ApiError(`${method} ${route} → ${res.status} ${detail.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    people: async () => (await call<{ people: CapturedPerson[] }>("GET", "/people")).people,
    uploadUrl: (mediaType: string) =>
      call<{ path: string; signedUrl: string }>("POST", "/intake/upload-url", { mediaType }),
    put: async (signedUrl: string, bytes: Buffer, mediaType: string) => {
      // The signed address carries its own token; the API key is not sent to storage.
      const res = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": mediaType },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new ApiError(`Upload → ${res.status}`, res.status);
    },
    postMessages: async (body: {
      personId: string;
      historical: boolean;
      messages: IntakeMessage[];
    }) => {
      await call("POST", "/intake/messages", {
        personId: body.personId,
        channel: "imessage",
        historical: body.historical,
        messages: body.messages,
      });
    },
    layout: async (body) => {
      await call("POST", "/intake/layout", body);
    },
    heartbeat: async () => {
      await call("POST", "/intake/heartbeat", {});
    },
  };
}
