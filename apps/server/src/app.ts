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
import { privacyRoutes } from "./routes/privacy.js";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", honoLogger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.on(
  ["GET", "PUT", "POST"],
  "/inngest",
  serve({
    client: inngest,
    functions: [summarizeVideo],
    serveHost: process.env.INNGEST_SERVE_HOST || "https://cliphy.vercel.app",
    servePath: "/api/inngest",
  }),
);

app.route("/auth", authRoutes);
app.route("/queue", queueRoutes);
app.route("/summaries", summaryRoutes);
app.route("/usage", usageRoutes);
app.route("/billing", billingRoutes);
app.route("/privacy", privacyRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  logger.error("Unhandled error", err);
  Sentry.captureException(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
