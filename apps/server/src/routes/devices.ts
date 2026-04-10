import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

export const deviceRoutes = new Hono<AppEnv>();

deviceRoutes.use("*", authMiddleware);

// Register push token
deviceRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const { token, platform } = await c.req.json();

  if (!token || !platform) {
    return c.json({ error: "token and platform are required" }, 400);
  }

  if (!["ios", "android"].includes(platform)) {
    return c.json({ error: "platform must be ios or android" }, 400);
  }

  const { error } = await supabase
    .from("push_tokens")
    .upsert({ user_id: userId, token, platform }, { onConflict: "user_id,token" });

  if (error) {
    return c.json({ error: "Failed to register token" }, 500);
  }

  return c.json({ registered: true });
});

// Unregister push token (for sign out)
deviceRoutes.delete("/", async (c) => {
  const userId = c.get("userId");
  const { token } = await c.req.json();

  await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);

  return c.json({ removed: true });
});
