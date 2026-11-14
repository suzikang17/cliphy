// Pairing with the phone: the helper shows a code, the owner types it into the
// app, and the server hands this Mac an API key. Nothing is copied by hand.

const POLL_MS = 2_000;

export interface PairDeps {
  post: (url: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Show the code to the person at the Mac. */
  show: (code: string) => void;
}

export interface Paired {
  apiKey: string;
  /** The account the key belongs to, to show before anything is uploaded. */
  account: string | null;
}

const errorOf = (body: unknown, fallback: string): string =>
  (body as { error?: string } | null)?.error ?? fallback;

export async function pairWithPhone(apiUrl: string, deps: PairDeps): Promise<Paired> {
  const base = `${apiUrl.replace(/\/+$/, "")}/api/pair`;
  const start = await deps.post(`${base}/start`, {});
  if (start.status !== 201) throw new Error(errorOf(start.body, "Could not start pairing."));
  const { code, pollToken, expiresAt } = start.body as {
    code: string;
    pollToken: string;
    expiresAt: string;
  };
  deps.show(code);

  const deadline = new Date(expiresAt).getTime();
  while (deps.now() < deadline) {
    await deps.sleep(POLL_MS);
    let reply: { status: number; body: unknown };
    try {
      reply = await deps.post(`${base}/poll`, { pollToken });
    } catch {
      continue; // A dropped connection is not an answer; ask again.
    }
    if (reply.status === 410) throw new Error("The code expired. Run pair again.");
    const body = reply.body as { status?: string; apiKey?: string; account?: string | null };
    if (reply.status === 200 && body.status === "paired" && body.apiKey) {
      return { apiKey: body.apiKey, account: body.account ?? null };
    }
  }
  throw new Error("The code expired. Run pair again.");
}

export const realPairDeps = (show: PairDeps["show"]): PairDeps => ({
  post: async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  show,
});
