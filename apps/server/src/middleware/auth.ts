import { createHash } from "crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";

const API_KEY_PREFIX = "cliphy_sk_";

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
      .select("id, user_id")
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

    c.set("userId", keyRow.user_id as string);
    c.set("userEmail", "");
    c.set("authMethod", "api_key");
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

  await next();
};
