import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";

/**
 * Gates a route to accounts with the creative-coach switch on.
 * Must be used AFTER authMiddleware (requires userId in context).
 */
export const requireCoach: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get("userId");
  const { data: user } = await supabase
    .from("users")
    .select("coach_enabled")
    .eq("id", userId)
    .single();

  if (!user?.coach_enabled) {
    return c.json({ error: "coach_not_enabled" as const }, 403);
  }
  await next();
};
