import type { MiddlewareHandler } from "hono";

const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header("x-forwarded-for") || "unknown";
    const now = Date.now();
    const entry = requests.get(key);

    if (!entry || now > entry.resetAt) {
      requests.set(key, { count: 1, resetAt: now + windowMs });
    } else if (entry.count >= maxRequests) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    } else {
      entry.count++;
    }

    await next();
  };
}
