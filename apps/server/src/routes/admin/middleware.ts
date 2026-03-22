import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";

const COOKIE_NAME = "admin_session";
const MAX_AGE = 86400; // 24 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET env var is required");
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createAdminCookie(): string {
  const ts = Date.now().toString();
  const sig = sign(ts);
  return `${ts}.${sig}`;
}

export function verifyAdminCookie(cookie: string): boolean {
  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return false;
  const ts = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);

  // Check signature (timing-safe)
  const expected = sign(ts);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return false;

  // Check expiry
  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age > MAX_AGE * 1000) return false;

  return true;
}

export function adminCookieHeader(cookieValue: string): string {
  return `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${MAX_AGE}`;
}

export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip auth for login page
  if (c.req.path.endsWith("/login")) return next();

  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie || !verifyAdminCookie(cookie)) {
    return c.redirect("/api/admin/login");
  }

  await next();
};
