import { createHash } from "crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";

const API_KEY_PREFIX = "cliphy_sk_";

// The whole of what a runner's key may do: claim a run, check in, finish, and
// upload a picture. It cannot read captured messages beyond the brief it is handed.
const RUNNER_CALLS = [
  /^\/coach\/runs\/claim$/,
  /^\/coach\/runs\/[^/]+\/(checkin|finish)$/,
  /^\/coach\/intake\/upload-url$/,
];

export function runnerMayCall(method: string, path: string): boolean {
  if (method !== "POST") return false;
  const route = path.replace(/^\/api(?=\/)/, "");
  return RUNNER_CALLS.some((pattern) => pattern.test(route));
}

// Touch users.last_active_at at most ~hourly — fire and forget, single
// conditional UPDATE (no read). Drives subscription-poll backoff for
// dormant users.
function touchLastActive(userId: string): void {
  const staleCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  void supabase
    .from("users")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", userId)
    .or(`last_active_at.is.null,last_active_at.lt.${staleCutoff}`)
    .then(
      () => {},
      () => {},
    );
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  if (token.startsWith(API_KEY_PREFIX)) {
    const keyHash = createHash("sha256").update(token).digest("hex");
    const { data: keyRow } = await supabase
      .from("api_keys")
      // Every column, not a list: naming `scope` would refuse every key on a
      // database where that column has not been added yet.
      .select("*")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!keyRow) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Fire and forget — last-used tracking shouldn't block the request
    void supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id as string)
      .then(
        () => {},
        () => {},
      );

    const scope = keyRow.scope === "runner" ? "runner" : null;
    if (scope === "runner" && !runnerMayCall(c.req.method, c.req.path)) {
      return c.json({ error: "This key cannot do that" }, 403);
    }

    c.set("userId", keyRow.user_id as string);
    c.set("userEmail", "");
    c.set("keyScope", scope);
    c.set("authMethod", "api_key");
    touchLastActive(keyRow.user_id as string);
    return next();
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email ?? "");
  c.set("authMethod", "jwt");
  c.set("keyScope", null);
  touchLastActive(user.id);

  await next();
};
