import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";
import { UPGRADE_URL } from "@cliphy/shared";
import type { ProFeature } from "@cliphy/shared";

/**
 * Middleware factory that gates a route to Pro users only.
 * Returns 402 Payment Required with an upgrade URL for free users.
 *
 * Must be used AFTER authMiddleware (requires userId in context).
 */
export function requirePro(feature: ProFeature): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get("userId");

    const { data: user } = await supabase.from("users").select("plan").eq("id", userId).single();

    const plan = (user?.plan as "free" | "pro") ?? "free";

    if (plan !== "pro") {
      return c.json(
        {
          error: "This feature requires a Pro subscription",
          code: "pro_required" as const,
          feature,
          upgrade_url: UPGRADE_URL,
        },
        402,
      );
    }

    await next();
  };
}
