import { initSentry } from "./lib/sentry.js";
initSentry();

import "./lib/env.js";
import { getRequestListener } from "@hono/node-server";
import app from "./app.js";

export default getRequestListener(app.fetch);
