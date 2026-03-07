import { initSentry } from "./lib/sentry.js";
initSentry();

import "./lib/env.js";
import { serve } from "@hono/node-server";
import app from "./app.js";
import { logger } from "./lib/logger.js";

const port = 3001;
logger.info("Server running", { port });
serve({ fetch: app.fetch, port });
