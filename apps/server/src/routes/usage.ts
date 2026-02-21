import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { PLAN_LIMITS } from "@cliphy/shared";
import type { UsageInfo } from "@cliphy/shared";

export const usageRoutes = new Hono<AppEnv>();

usageRoutes.use("*", authMiddleware);

// GET / — Return usage info for the current user
usageRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: user, error } = await supabase
    .from("users")
    .select("plan, daily_summary_count, daily_count_reset_at")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return c.json({ error: "User not found" }, 404);
  }

  const plan = (user.plan as "free" | "pro") ?? "free";
  const limit = PLAN_LIMITS[plan];

  // If the reset date is before today, the count has effectively reset
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const used = user.daily_count_reset_at < today ? 0 : user.daily_summary_count;

  const usage: UsageInfo = {
    used,
    limit,
    plan,
    resetAt: user.daily_count_reset_at,
  };

  return c.json({ usage });
});
