import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminAuthMiddleware } from "./middleware.js";
import { loginRoutes } from "./login.js";
import { adminUserRoutes } from "./users.js";
import { adminSummaryRoutes } from "./summaries.js";
import { adminQueueRoutes } from "./queue.js";

export const adminRoutes = new Hono();

// Serve HTMX from node_modules (self-hosted to avoid CSP issues).
// In production (Vercel serverless), node_modules is unavailable at runtime —
// the build script copies htmx.min.js next to the bundle (__dirname).
// In dev, fall back to reading from node_modules directly.
let htmxJs: string | null = null;
function getHtmxJs(): string {
  if (!htmxJs) {
    try {
      // Production: file copied next to bundle by build-vercel.sh
      htmxJs = readFileSync(resolve(__dirname, "htmx.min.js"), "utf-8");
    } catch {
      // Dev: read from node_modules
      htmxJs = readFileSync("node_modules/htmx.org/dist/htmx.min.js", "utf-8");
    }
  }
  return htmxJs;
}

adminRoutes.get("/htmx.js", (c) => {
  c.header("Content-Type", "application/javascript");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(getHtmxJs());
});

// Auth middleware applies to all admin routes (skips login internally)
adminRoutes.use("*", adminAuthMiddleware);

// Mount sub-routes
adminRoutes.route("/login", loginRoutes);
adminRoutes.route("/users", adminUserRoutes);
adminRoutes.route("/summaries", adminSummaryRoutes);
adminRoutes.route("/queue", adminQueueRoutes);

// Dashboard redirect
adminRoutes.get("/", (c) => c.redirect("/api/admin/users"));
