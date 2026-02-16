import { Hono } from "hono";

export const authRoutes = new Hono();

authRoutes.get("/callback", async (c) => {
  // TODO: Handle Supabase auth callback
  return c.json({ message: "auth callback" });
});

authRoutes.get("/me", async (c) => {
  // TODO: Return current user info
  return c.json({ message: "current user" });
});
