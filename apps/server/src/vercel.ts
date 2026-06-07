import { initSentry } from "./lib/sentry.js";
initSentry();

import "./lib/env.js";
import { getRequestListener } from "@hono/node-server";
import { Sentry } from "./lib/sentry.js";
import app from "./app.js";

const listener = getRequestListener(app.fetch);

// On Vercel serverless the function can freeze before Sentry's background transport
// sends the request's trace, so flush after every request (same reason onError does).
export default async function handler(
  req: Parameters<typeof listener>[0],
  res: Parameters<typeof listener>[1],
) {
  try {
    await listener(req, res);
  } finally {
    await Sentry.flush(2000);
  }
}
