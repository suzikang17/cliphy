import { createHash } from "crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";
import { clientOf, type ClientKind } from "../services/clientKind.js";

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

// Touch users.last_active_at at most ~hourly — fire and forget, one
// conditional statement (`touch_user`, migration 052). Drives subscription-poll
// backoff for dormant users, and notes which app the account uses. `client` is
// null for API keys: a key says nothing about which app the person signed up in.
function touchLastActive(userId: string, client: ClientKind | null): void {
  void supabase.rpc("touch_user", { p_user_id: userId, p_client: client }).then(
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
    touchLastActive(keyRow.user_id as string, null);
    return next();
  }

  // A sign-in token is checked here, against the project's public signing
  // keys (fetched once and kept for ten minutes), not by asking Supabase about
  // each request. A token signed the older way (a shared secret, no public
  // key) is still checked by asking, inside getClaims. The cost of checking
  // here: a session that was signed out stays good until its token runs out,
  // an hour at most.
  // getClaims throws for some bad tokens (an expired one, one that is not a
  // token at all) instead of answering with an error. Either way it is a 401,
  // which is what tells the apps to renew their sign-in.
  const { data, error } = await supabase.auth
    .getClaims(token)
    .catch(() => ({ data: null, error: new Error("invalid token") }));
  const claims = data?.claims;
  // The project's own API keys are tokens too, with no person in them.
  if (error || !claims || typeof claims.sub !== "string" || !claims.sub) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", claims.sub);
  c.set("userEmail", typeof claims.email === "string" ? claims.email : "");
  c.set("authMethod", "jwt");
  c.set("keyScope", null);
  touchLastActive(
    claims.sub,
    clientOf({ origin: c.req.header("Origin"), userAgent: c.req.header("User-Agent") }),
  );

  await next();
};
