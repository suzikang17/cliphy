import { Hono } from "hono";

export const usageRoutes = new Hono();

usageRoutes.get("/", async (c) => {
  // TODO: Return usage info for current user
  return c.json({
    usage: { used: 0, limit: 5, plan: "free", resetAt: "" },
  });
});
