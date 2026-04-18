import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "inngest/hono";
import type { AppEnv } from "./env.js";
import { inngest } from "./lib/inngest.js";
import { logger } from "./lib/logger.js";
import { Sentry } from "./lib/sentry.js";
import { summarizeVideo } from "./functions/summarize-video.js";
import { authRoutes } from "./routes/auth.js";
import { queueRoutes } from "./routes/queue.js";
import { summaryRoutes } from "./routes/summaries.js";
import { usageRoutes } from "./routes/usage.js";
import { billingRoutes } from "./routes/billing.js";
import { adminRoutes } from "./routes/admin/index.js";
import { deviceRoutes } from "./routes/devices.js";
import { settingsRoutes } from "./routes/settings.js";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0 && process.env.NODE_ENV !== "development") {
  throw new Error("ALLOWED_ORIGINS must be set in non-development environments");
}

const app = new Hono<AppEnv>().basePath("/api");

const isAdminRoute = (path: string) => path.startsWith("/api/admin");

app.use("*", honoLogger());
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  return secureHeaders()(c, next);
});
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  const origin = c.req.header("Origin");
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return next();
});
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  return cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })(c, next);
});

app.on(
  ["GET", "PUT", "POST"],
  "/inngest",
  serve({
    client: inngest,
    functions: [summarizeVideo],
    serveHost: process.env.INNGEST_SERVE_HOST || "https://cliphy.app",
    servePath: "/api/inngest",
  }),
);

app.route("/auth", authRoutes);
app.route("/queue", queueRoutes);
app.route("/summaries", summaryRoutes);
app.route("/usage", usageRoutes);
app.route("/billing", billingRoutes);
app.route("/devices", deviceRoutes);
app.route("/admin", adminRoutes);
app.route("/settings", settingsRoutes);

app.onError(async (err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  logger.error("Unhandled error", err);
  Sentry.captureException(err, {
    tags: { component: "hono", error_category: "unhandled" },
  });
  await Sentry.flush(2000);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
