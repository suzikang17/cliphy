import { POSTHOG_HOST, POSTHOG_KEY } from "@cliphy/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { clientOf } from "../services/clientKind.js";
import { supabase } from "./supabase.js";

// Product analytics (PostHog, ADR 0073), sent from the server so every app is
// covered without a release. A person is known here by their account id only:
// no email, no titles, no links, no text of anything they saved.

/** Only the deployed production server sends; local runs and tests stay quiet. */
const enabled = () => process.env.VERCEL_ENV === "production";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

/**
 * Record one event for an account. Resolves when sent (or given up on): a
 * request handler lets it run in the background, a job step awaits it.
 * Never throws: analytics must not be able to fail a save.
 */
export async function track(
  userId: string,
  event: string,
  props: AnalyticsProps = {},
): Promise<void> {
  if (!enabled()) return;
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: userId,
        properties: { ...props, $lib: "cliphy-server" },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Dropped: one missing event is better than a slower or failed request.
  }
}

/**
 * Let a send finish after the response has gone out. On Vercel a function may
 * be frozen once it has answered; its request context offers `waitUntil` for
 * exactly this. Elsewhere the promise simply runs.
 */
export function inBackground(work: Promise<unknown>): void {
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
    | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined }
    | undefined;
  try {
    ctx?.get?.()?.waitUntil?.(work);
  } catch {
    // No request context: nothing to hold open.
  }
}

/** What a save request was for, by where it was posted. Null: not a save. */
export function saveKind(method: string, path: string): string | null {
  if (method !== "POST") return null;
  const route = path.replace(/^\/api(?=\/)/, "").replace(/\/$/, "");
  if (route === "/queue") return "video";
  if (route === "/queue/batch") return "video_batch";
  // A link (article, post) or a picture: the same route takes both.
  if (route === "/clips") return "clip";
  if (route === "/clips/quick") return "quick";
  if (route === "/notes") return "note";
  if (route === "/notes/voice") return "voice";
  return null;
}

/**
 * After a save request: `clip_saved` when it was stored, `save_refused` with
 * the status and the refusal's code when it was not. A refusal leaves no row
 * in the database, so this is the only record that someone tried.
 */
export const trackSaves: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const kind = saveKind(c.req.method, c.req.path);
  const userId = c.get("userId");
  if (!kind || !userId) return;

  const status = c.res.status;
  const base = {
    kind,
    client: clientOf({ origin: c.req.header("Origin"), userAgent: c.req.header("User-Agent") }),
    auth: c.get("authMethod") ?? null,
  };
  if (status >= 200 && status < 300) {
    inBackground(track(userId, "clip_saved", base));
    return;
  }
  let code: string | null = null;
  try {
    const body = (await c.res.clone().json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    // Not JSON: the status alone is recorded.
  }
  inBackground(track(userId, "save_refused", { ...base, status, code }));
};

/** A job's result for a clip, recorded against the account that owns it. */
export async function trackClipOutcome(
  clipId: string,
  event: "summary_completed" | "summary_failed",
  props: AnalyticsProps = {},
): Promise<void> {
  if (!enabled()) return;
  try {
    const { data } = await supabase
      .from("clips")
      .select("user_id, source_type")
      .eq("id", clipId)
      .maybeSingle();
    if (!data?.user_id) return;
    await track(data.user_id as string, event, { ...props, kind: data.source_type as string });
  } catch {
    // Never fail the job over analytics.
  }
}
