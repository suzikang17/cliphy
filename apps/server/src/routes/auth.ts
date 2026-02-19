import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, plan, daily_summary_count, daily_count_reset_at, created_at")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});
