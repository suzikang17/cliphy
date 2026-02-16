import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth.js";
import { queueRoutes } from "./routes/queue.js";
import { summaryRoutes } from "./routes/summaries.js";
import { usageRoutes } from "./routes/usage.js";
import { billingRoutes } from "./routes/billing.js";

const app = new Hono().basePath("/api");

app.use("*", logger());
app.use("*", cors());

app.route("/auth", authRoutes);
app.route("/queue", queueRoutes);
app.route("/summaries", summaryRoutes);
app.route("/usage", usageRoutes);
app.route("/billing", billingRoutes);

app.get("/health", (c) => c.json({ status: "ok" }));

const port = 3000;
console.log(`Server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });

export default app;
