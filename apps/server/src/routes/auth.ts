import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { isValidEmail, type EmailAuthStatus } from "@cliphy/shared";
import { checkRateLimit } from "../lib/rateLimit.js";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, plan, monthly_summary_count, monthly_count_reset_at, created_at")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

// POST /check-email — email-first flow: classify an email (no auth required).
authRoutes.post("/check-email", async (c) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(`check-email:${ip}`, 10, 60_000)) {
    return c.json({ error: "Too many requests" }, 429);
  }

  let body: { email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return c.json({ error: "Valid email required" }, 400);
  }

  const { data, error } = await supabase.rpc("email_auth_status", { p_email: email });
  if (error) {
    return c.json({ error: "Lookup failed" }, 500);
  }

  return c.json({ status: data as EmailAuthStatus });
});
