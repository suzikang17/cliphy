import { initSentry } from "./lib/sentry.js";
initSentry();

import "./lib/env.js";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import app from "./app.js";
import { privacyRoutes } from "./routes/privacy.js";
import { termsRoutes } from "./routes/terms.js";

// Root app handles paths outside the /api basePath (e.g. /privacy, /terms)
const root = new Hono();
root.route("/privacy", privacyRoutes);
root.route("/terms", termsRoutes);
root.route("/", app);

export default getRequestListener(root.fetch);
