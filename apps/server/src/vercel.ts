import { initSentry } from "./lib/sentry.js";
initSentry();

import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import app from "./app.js";
import { privacyRoutes } from "./routes/privacy.js";

// Root app handles paths outside the /api basePath (e.g. /privacy)
const root = new Hono();
root.route("/privacy", privacyRoutes);
root.route("/", app);

export default getRequestListener(root.fetch);
