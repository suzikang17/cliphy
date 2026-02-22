import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "inngest/hono";
import type { AppEnv } from "./env.js";
import { inngest } from "./lib/inngest.js";
import { summarizeVideo } from "./functions/summarize-video.js";
import { authRoutes } from "./routes/auth.js";
import { queueRoutes } from "./routes/queue.js";
import { summaryRoutes } from "./routes/summaries.js";
import { usageRoutes } from "./routes/usage.js";
import { billingRoutes } from "./routes/billing.js";
import { summarizeRoutes } from "./routes/summarize.js";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", logger());
app.use("*", cors());

app.on(
  ["GET", "PUT", "POST"],
  "/inngest",
  serve({
    client: inngest,
    functions: [summarizeVideo],
    serveHost: process.env.INNGEST_SERVE_HOST,
    servePath: "/api/inngest",
  }),
);

app.route("/auth", authRoutes);
app.route("/queue", queueRoutes);
app.route("/summaries", summaryRoutes);
app.route("/usage", usageRoutes);
app.route("/billing", billingRoutes);
app.route("/summarize", summarizeRoutes);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
