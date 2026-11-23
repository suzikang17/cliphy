// Links shared into the app, kept on the phone until the server has them.
//
// Sharing confirms at once: the link is written here first, then sent in the
// background. If the app is put away before the send finishes, or there is no
// network, the link waits and is sent the next time the app comes to the front.
// A link the server refuses (monthly limit, a bad link) is dropped and the
// refusal is shown; one it already has is dropped quietly.

export interface OutboxItem {
  id: string;
  url: string;
  addedAt: string;
  /** Sends that failed for a reason worth trying again. */
  tries: number;
}

export interface OutboxDeps {
  /** The stored list, or null when nothing was stored. */
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  /** Send one link to the server. Throws what the API client throws. */
  send(url: string): Promise<void>;
  /** The server said no, for good: tell the person. */
  refused(err: unknown, item: OutboxItem): void;
  now(): Date;
}

/** After this many failed sends a link is given up on, and the last failure shown. */
export const MAX_TRIES = 6;

/** What a failed send means for the link. */
export type Verdict = "retry" | "have" | "refused";

/**
 * retry: no answer, a server fault, or a sign-in that needs renewing.
 * have: the server already has it. refused: the server said no.
 */
export function judge(err: unknown): Verdict {
  const e = err as { name?: unknown; status?: unknown } | null;
  if (e?.name === "DuplicateError") return "have";
  if (e?.name === "AuthError") return "retry";
  if (typeof e?.status === "number") {
    // 409 is how the server says an article or post is already saved.
    if (e.status === 409) return "have";
    return e.status >= 500 ? "retry" : "refused";
  }
  // The named refusals (limit reached, Pro needed) carry no status.
  if (e?.name === "RateLimitError" || e?.name === "ProRequiredError") return "refused";
  // Anything else is the request not getting through.
  return "retry";
}

export function createOutbox(deps: OutboxDeps) {
  let items: OutboxItem[] | null = null;
  let flushing: Promise<void> | null = null;
  /** Writes happen one after another, so a late one cannot undo a newer one. */
  let writing: Promise<void> = Promise.resolve();

  async function read(): Promise<OutboxItem[]> {
    if (items) return items;
    let stored: OutboxItem[] = [];
    try {
      const parsed: unknown = JSON.parse((await deps.load()) ?? "[]");
      if (Array.isArray(parsed)) {
        stored = parsed.filter(
          (i): i is OutboxItem => typeof i?.id === "string" && typeof i?.url === "string",
        );
      }
    } catch {
      // A damaged list starts empty; nothing in it could be sent anyway.
    }
    // A link added while the list was being read is already in `items`.
    items = items ?? stored;
    return items;
  }

  function write(): Promise<void> {
    const value = JSON.stringify(items ?? []);
    writing = writing.then(() => deps.save(value)).catch(() => {});
    return writing;
  }

  async function run(): Promise<void> {
    const list = await read();
    // Each link waiting now gets one try; a new one added meanwhile is picked up too.
    const seen = new Set<string>();
    for (;;) {
      const item = list.find((i) => !seen.has(i.id));
      if (!item) return;
      seen.add(item.id);
      let verdict: Verdict | "sent" = "sent";
      let failure: unknown;
      try {
        await deps.send(item.url);
      } catch (err) {
        failure = err;
        verdict = judge(err);
      }
      if (verdict === "retry") {
        item.tries += 1;
        if (item.tries < MAX_TRIES) {
          await write();
          // The network or the server is down: the rest would fail the same way.
          return;
        }
        verdict = "refused";
      }
      list.splice(list.indexOf(item), 1);
      await write();
      if (verdict === "refused") deps.refused(failure, item);
    }
  }

  return {
    /** Keep a link. Resolves once it is stored on the phone, before it is sent. */
    async add(url: string): Promise<void> {
      const list = await read();
      // The share sheet can fire the same link two or three times.
      if (!list.some((i) => i.url === url)) {
        const at = deps.now();
        list.push({
          id: `${at.getTime()}-${list.length}`,
          url,
          addedAt: at.toISOString(),
          tries: 0,
        });
        await write();
      }
    },

    /** Send everything waiting. Safe to call at any time; runs once at a time. */
    flush(): Promise<void> {
      flushing ??= run().finally(() => {
        flushing = null;
      });
      return flushing;
    },

    async waiting(): Promise<number> {
      return (await read()).length;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
