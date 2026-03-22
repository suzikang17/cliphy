import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { adminAuthMiddleware } from "./middleware.js";
import { loginRoutes } from "./login.js";
import { adminUserRoutes } from "./users.js";
import { adminSummaryRoutes } from "./summaries.js";

export const adminRoutes = new Hono();

// Serve HTMX from node_modules (self-hosted to avoid CSP issues)
let htmxJs: string | null = null;
function getHtmxJs(): string {
  if (!htmxJs) {
    try {
      htmxJs = readFileSync(require.resolve("htmx.org/dist/htmx.min.js"), "utf-8");
    } catch {
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

// Dashboard redirect
adminRoutes.get("/", (c) => c.redirect("/api/admin/users"));
