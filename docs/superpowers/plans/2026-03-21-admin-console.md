# Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-rendered admin console into the existing Hono server with HTMX interactivity for managing users, summaries, and queue.

**Architecture:** Hono JSX + HTMX admin pages mounted at `/api/admin/*` under the existing basePath. Cookie-based auth with HMAC-signed secret. Views co-located with routes, shared layout in `admin-views/`.

**Tech Stack:** Hono (JSX), HTMX (self-hosted), Supabase (existing service_role client), Stripe SDK (existing), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-21-admin-console-design.md`

---

## File Structure

```
apps/server/src/
  routes/
    admin/
      index.ts          — admin Hono sub-app, mounts all admin routes
      middleware.ts      — HMAC cookie auth guard
      login.tsx          — login page + POST handler
      users.tsx          — user list, detail, actions
      summaries.tsx      — summary browser + detail
      queue.tsx          — queue monitor dashboard
  views/
    admin/
      layout.tsx         — HTML shell (head, nav, HTMX script, styles)
      components.tsx     — reusable table, stats-card, pagination, status-badge
  services/
    admin.ts            — shared admin operations (downgrade, upgrade)
  routes/admin/__tests__/
    middleware.test.ts   — auth middleware tests
    users.test.ts        — user routes tests
    summaries.test.ts    — summary routes tests
    queue.test.ts        — queue routes tests
```

**Modified files:**

- `apps/server/src/app.ts` — mount admin routes, skip CORS/secureHeaders for admin
- `apps/server/tsconfig.json` — add JSX config
- `scripts/build-vercel.sh` — add esbuild JSX flags
- `apps/server/scripts/downgrade-user.ts` — left as-is (duplicated logic acceptable for standalone script)

---

## Task 1: JSX Configuration

**Files:**

- Modify: `apps/server/tsconfig.json`
- Modify: `scripts/build-vercel.sh`

- [ ] **Step 0: Install htmx.org for self-hosting**

Run: `pnpm --filter server add htmx.org`

- [ ] **Step 1: Update tsconfig for Hono JSX**

In `apps/server/tsconfig.json`, add JSX compiler options:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono"
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Update esbuild flags**

In `scripts/build-vercel.sh`, add JSX flags to the esbuild command:

```bash
pnpm exec esbuild apps/server/src/vercel.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --jsx=automatic \
  --jsx-import-source=hono \
  --outfile=.vercel/output/functions/api/index.func/index.js
```

- [ ] **Step 3: Verify build still works**

Run: `pnpm --filter server build`
Expected: Build succeeds with no errors (no JSX files yet, so no change in behavior)

- [ ] **Step 4: Commit**

```bash
git add apps/server/tsconfig.json scripts/build-vercel.sh
git commit -m "configure Hono JSX for server (tsconfig + esbuild)"
```

---

## Task 2: Admin Layout & Components

**Files:**

- Create: `apps/server/src/views/admin/layout.tsx`
- Create: `apps/server/src/views/admin/components.tsx`

- [ ] **Step 1: Create the admin layout**

`apps/server/src/views/admin/layout.tsx` — the HTML shell that wraps all admin pages. Includes:

- `<html>` with `<head>` (title, inline `<style>` block for admin CSS)
- HTMX loaded via inline `<script>` (self-hosted, ~14KB minified — fetch from `https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js` at build time, or use a small inline snippet that loads it)
- Navigation bar with links: Dashboard, Users, Summaries, Queue
- `{children}` slot for page content
- Minimal, functional CSS: system font stack, basic table styles, card layout, status badges, form controls

```tsx
import type { FC, PropsWithChildren } from "hono/jsx";

export const AdminLayout: FC<PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title ? `${title} — Cliphy Admin` : "Cliphy Admin"}</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; }
        .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
        nav { background: #1a1a1a; color: white; padding: 0.75rem 1rem; display: flex; gap: 1.5rem; align-items: center; }
        nav a { color: #ccc; text-decoration: none; font-size: 0.9rem; }
        nav a:hover, nav a.active { color: white; }
        nav .brand { font-weight: bold; font-size: 1.1rem; color: white; margin-right: 1rem; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; color: #666; }
        tr:hover { background: #f9f9f9; }
        tr:last-child td { border-bottom: none; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
        .stat-card { background: white; border-radius: 8px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stat-card .value { font-size: 2rem; font-weight: bold; }
        .stat-card .label { font-size: 0.85rem; color: #666; margin-top: 0.25rem; }
        .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
        .badge-free { background: #e0f2fe; color: #0369a1; }
        .badge-pro { background: #fce7f3; color: #be185d; }
        .badge-active { background: #dcfce7; color: #15803d; }
        .badge-canceled, .badge-none { background: #f3f4f6; color: #6b7280; }
        .badge-past_due { background: #fef3c7; color: #92400e; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .badge-processing { background: #dbeafe; color: #1d4ed8; }
        .badge-completed { background: #dcfce7; color: #15803d; }
        .badge-failed { background: #fee2e2; color: #b91c1c; }
        .filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
        .filters select, .filters input { padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
        .filters input[type="search"] { min-width: 250px; }
        .btn { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; }
        .btn-primary { background: #2563eb; color: white; }
        .btn-danger { background: #dc2626; color: white; }
        .btn-secondary { background: #e5e7eb; color: #374151; }
        .btn:hover { opacity: 0.9; }
        .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
        .pagination { display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: center; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
        .detail-row .label { color: #666; font-size: 0.9rem; }
        .section { margin-bottom: 2rem; }
        .section h2 { font-size: 1.25rem; margin-bottom: 1rem; }
        h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
        a.row-link { color: inherit; text-decoration: none; }
        .login-form { max-width: 400px; margin: 4rem auto; }
        .login-form input[type="password"] { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem; margin-bottom: 1rem; }
        .login-form .btn { width: 100%; }
        .error { color: #dc2626; margin-bottom: 1rem; font-size: 0.9rem; }
        .success { color: #15803d; margin-bottom: 1rem; font-size: 0.9rem; }
        pre { background: #1a1a1a; color: #e5e7eb; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
      `}</style>
    </head>
    <body>
      <nav>
        <span class="brand">Cliphy Admin</span>
        <a href="/api/admin/users">Users</a>
        <a href="/api/admin/summaries">Summaries</a>
        <a href="/api/admin/queue">Queue</a>
      </nav>
      <div class="container">{children}</div>
      <script src="/api/admin/htmx.js"></script>
    </body>
  </html>
);
```

Note on HTMX delivery: HTMX is served from a dedicated route (`GET /api/admin/htmx.js`) to avoid CSP issues with `secureHeaders()`. The admin router serves the vendored HTMX file from `node_modules/htmx.org/dist/htmx.min.js`. Add `htmx.org` as a dependency: `pnpm --filter server add htmx.org`.

- [ ] **Step 2: Create reusable components**

`apps/server/src/views/admin/components.tsx` — shared UI components:

```tsx
import type { FC } from "hono/jsx";

// Stats card for dashboard numbers
export const StatsCard: FC<{ label: string; value: string | number; badge?: string }> = ({
  label,
  value,
  badge,
}) => (
  <div class="stat-card">
    <div class="value">
      {value}
      {badge && (
        <span class={`badge badge-${badge}`} style="font-size:0.5em;margin-left:0.5rem">
          {badge}
        </span>
      )}
    </div>
    <div class="label">{label}</div>
  </div>
);

// Status badge
export const StatusBadge: FC<{ status: string }> = ({ status }) => (
  <span class={`badge badge-${status}`}>{status}</span>
);

// Plan badge
export const PlanBadge: FC<{ plan: string }> = ({ plan }) => (
  <span class={`badge badge-${plan}`}>{plan}</span>
);

// Pagination controls
export const Pagination: FC<{
  page: number;
  total: number;
  perPage: number;
  baseUrl: string;
  targetId: string;
}> = ({ page, total, perPage, baseUrl, targetId }) => {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  const separator = baseUrl.includes("?") ? "&" : "?";

  return (
    <div class="pagination">
      {page > 1 && (
        <button
          class="btn btn-secondary"
          hx-get={`${baseUrl}${separator}page=${page - 1}`}
          hx-target={`#${targetId}`}
          hx-swap="outerHTML"
        >
          ← Prev
        </button>
      )}
      <span style="padding:0.5rem;color:#666">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <button
          class="btn btn-secondary"
          hx-get={`${baseUrl}${separator}page=${page + 1}`}
          hx-target={`#${targetId}`}
          hx-swap="outerHTML"
        >
          Next →
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Verify TypeScript compiles the JSX**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors (verifies JSX config from Task 1 works with these files)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/views/admin/
git commit -m "add admin layout and reusable components"
```

---

## Task 3: Auth Middleware & Login

**Files:**

- Create: `apps/server/src/routes/admin/middleware.ts`
- Create: `apps/server/src/routes/admin/login.tsx`
- Create: `apps/server/src/routes/admin/__tests__/middleware.test.ts`

- [ ] **Step 1: Write middleware tests**

`apps/server/src/routes/admin/__tests__/middleware.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock env
vi.stubEnv("ADMIN_SECRET", "test-secret-123");

async function createTestApp() {
  const { adminAuthMiddleware, createAdminCookie, verifyAdminCookie } =
    await import("../middleware.js");
  const app = new Hono();
  app.use("/admin/*", adminAuthMiddleware);
  app.get("/admin/test", (c) => c.text("ok"));
  return { app, createAdminCookie, verifyAdminCookie };
}

describe("Admin Auth Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when no cookie", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/admin/test");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/login");
  });

  it("rejects invalid cookie signature", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/admin/test", {
      headers: { Cookie: "admin_session=fake.invalidsig" },
    });
    expect(res.status).toBe(302);
  });

  it("allows valid cookie", async () => {
    const { app, createAdminCookie } = await createTestApp();
    const cookie = createAdminCookie();
    const res = await app.request("/admin/test", {
      headers: { Cookie: `admin_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("createAdminCookie and verifyAdminCookie round-trip", async () => {
    const { createAdminCookie, verifyAdminCookie } = await createTestApp();
    const cookie = createAdminCookie();
    expect(verifyAdminCookie(cookie)).toBe(true);
  });

  it("verifyAdminCookie rejects tampered value", async () => {
    const { verifyAdminCookie } = await createTestApp();
    expect(verifyAdminCookie("tampered.value")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/middleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the middleware**

`apps/server/src/routes/admin/middleware.ts`:

```typescript
import { createHmac } from "node:crypto";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";

const COOKIE_NAME = "admin_session";
const MAX_AGE = 86400; // 24 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET env var is required");
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createAdminCookie(): string {
  const ts = Date.now().toString();
  const sig = sign(ts);
  return `${ts}.${sig}`;
}

export function verifyAdminCookie(cookie: string): boolean {
  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return false;
  const ts = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);

  // Check signature
  const expected = sign(ts);
  if (sig !== expected) return false;

  // Check expiry
  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age > MAX_AGE * 1000) return false;

  return true;
}

export function adminCookieHeader(cookieValue: string): string {
  return `${COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${MAX_AGE}`;
}

export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip auth for login page
  if (c.req.path.endsWith("/login")) return next();

  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie || !verifyAdminCookie(cookie)) {
    return c.redirect("/api/admin/login");
  }

  await next();
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/middleware.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Implement login page**

`apps/server/src/routes/admin/login.tsx`:

```tsx
import { Hono } from "hono";
import { AdminLayout } from "../../views/admin/layout.js";
import { createAdminCookie, adminCookieHeader } from "./middleware.js";

export const loginRoutes = new Hono();

loginRoutes.get("/", (c) => {
  const error = c.req.query("error");
  return c.html(
    <AdminLayout title="Login">
      <div class="login-form card">
        <h1>Admin Login</h1>
        {error && <div class="error">Invalid password</div>}
        <form method="POST" action="/api/admin/login">
          <input type="password" name="password" placeholder="Admin secret" autofocus required />
          <button type="submit" class="btn btn-primary">
            Log in
          </button>
        </form>
      </div>
    </AdminLayout>,
  );
});

loginRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const password = body["password"] as string;

  if (password !== process.env.ADMIN_SECRET) {
    return c.redirect("/api/admin/login?error=1");
  }

  const cookie = createAdminCookie();
  c.header("Set-Cookie", adminCookieHeader(cookie));
  return c.redirect("/api/admin/users");
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin/middleware.ts apps/server/src/routes/admin/login.tsx apps/server/src/routes/admin/__tests__/middleware.test.ts
git commit -m "add admin auth middleware and login page"
```

---

## Task 4: Admin Service Layer

**Files:**

- Create: `apps/server/src/services/admin.ts`

- [ ] **Step 1: Create shared admin service**

`apps/server/src/services/admin.ts` — extracts downgrade logic and adds upgrade:

```typescript
import { supabase } from "../lib/supabase.js";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function downgradeUser(userId: string): Promise<void> {
  // Fetch current subscription
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .single();

  if (error || !user) throw new Error(`User not found: ${userId}`);

  // Cancel Stripe subscription if exists
  if (user.stripe_subscription_id) {
    const stripe = getStripe();
    try {
      await stripe.subscriptions.cancel(user.stripe_subscription_id);
    } catch (err: any) {
      if (err.code !== "resource_missing") throw err;
    }
  }

  // Reset DB
  const { error: updateErr } = await supabase
    .from("users")
    .update({
      plan: "free",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
    })
    .eq("id", userId);

  if (updateErr) throw new Error(`Failed to downgrade: ${updateErr.message}`);
}

export async function upgradeUser(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({
      plan: "pro",
      subscription_status: "active",
    })
    .eq("id", userId);

  if (error) throw new Error(`Failed to upgrade: ${error.message}`);
}

export async function cancelSubscription(userId: string): Promise<void> {
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .single();

  if (error || !user) throw new Error(`User not found: ${userId}`);
  if (!user.stripe_subscription_id) throw new Error("No subscription to cancel");

  const stripe = getStripe();
  await stripe.subscriptions.cancel(user.stripe_subscription_id);

  await supabase.from("users").update({ subscription_status: "canceled" }).eq("id", userId);
}

export async function resetMonthlyCount(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ monthly_summary_count: 0 })
    .eq("id", userId);

  if (error) throw new Error(`Failed to reset count: ${error.message}`);
}
```

Note: Leave `apps/server/scripts/downgrade-user.ts` as-is. It runs standalone outside the server process and creates its own Supabase/Stripe clients. Importing the service module would trigger the server's Supabase singleton initialization, which could fail in the script context. The duplication is acceptable — the admin service is the canonical version going forward, and the script is a dev-only tool.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services/admin.ts
git commit -m "add admin service layer for user operations"
```

---

## Task 5: Mount Admin Routes & Fix Middleware

**Files:**

- Create: `apps/server/src/routes/admin/index.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Create admin router index**

`apps/server/src/routes/admin/index.ts`:

```typescript
import { Hono } from "hono";
import { adminAuthMiddleware } from "./middleware.js";
import { loginRoutes } from "./login.js";

// Will add more routes in subsequent tasks
export const adminRoutes = new Hono();

// Serve HTMX from node_modules (self-hosted to avoid CSP issues)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let htmxJs: string | null = null;
function getHtmxJs(): string {
  if (!htmxJs) {
    // In bundled output, require.resolve works; fallback to known path
    try {
      htmxJs = readFileSync(require.resolve("htmx.org/dist/htmx.min.js"), "utf-8");
    } catch {
      htmxJs = readFileSync(resolve("node_modules/htmx.org/dist/htmx.min.js"), "utf-8");
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

// Dashboard redirect
adminRoutes.get("/", (c) => c.redirect("/api/admin/users"));
```

- [ ] **Step 2: Mount admin in app.ts, skip CORS/secureHeaders for admin routes**

Modify `apps/server/src/app.ts`. The key changes:

1. Import and mount `adminRoutes`
2. Skip the origin check for admin routes (admin auth handles security)
3. Skip `secureHeaders` for admin routes (would block inline styles and HTMX)

The modified middleware stack checks if the request is for admin routes and skips CORS/secureHeaders. **Important:** `c.req.path` in Hono returns the full URL path (e.g. `/api/admin/users`), not relative to basePath. So the check must use `/api/admin`:

```typescript
// Add import at top:
import { adminRoutes } from "./routes/admin/index.js";

// Helper to check if request is for admin routes
const isAdminRoute = (path: string) => path.startsWith("/api/admin");

// Modify the secureHeaders middleware to skip admin routes:
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  return secureHeaders()(c, next);
});

// Modify the origin check middleware to skip admin routes:
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  const origin = c.req.header("Origin");
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return next();
});

// Modify CORS to skip admin routes:
app.use("*", async (c, next) => {
  if (isAdminRoute(c.req.path)) return next();
  return cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })(c, next);
});

// Mount admin routes (before or after existing routes):
app.route("/admin", adminRoutes);
```

Note: `c.req.path` in Hono returns the full URL path (e.g. `/api/admin/users`), not relative to basePath.

- [ ] **Step 3: Verify the server starts locally**

Run: `pnpm dev:server`
Expected: Server starts without errors. Visiting `http://localhost:3000/api/admin/login` shows the login form.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/admin/index.ts apps/server/src/app.ts
git commit -m "mount admin routes with middleware bypass"
```

---

## Task 6: Users List Page

**Files:**

- Create: `apps/server/src/routes/admin/users.tsx`
- Modify: `apps/server/src/routes/admin/index.ts`
- Create: `apps/server/src/routes/admin/__tests__/users.test.ts`

- [ ] **Step 1: Write tests for user list**

`apps/server/src/routes/admin/__tests__/users.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.stubEnv("ADMIN_SECRET", "test-secret-123");

// Mock supabase
const mockFrom = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: vi.fn() },
  },
}));

// Mock admin auth middleware (skip auth in tests)
vi.mock("../middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware.js")>();
  return {
    ...actual,
    adminAuthMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
  };
});

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, any> = {};
  const methods = ["select", "eq", "ilike", "order", "range", "is", "not", "single", "neq"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminUserRoutes } = await import("../users.js");
  const app = new Hono();
  app.route("/admin/users", adminUserRoutes);
  return app;
}

describe("Admin Users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/users returns user list page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "u1",
            email: "test@example.com",
            plan: "free",
            subscription_status: "none",
            monthly_summary_count: 3,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        count: 1,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/users");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test@example.com");
    expect(html).toContain("free");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/users.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement user list and detail routes**

`apps/server/src/routes/admin/users.tsx`:

```tsx
import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatusBadge, PlanBadge, Pagination, StatsCard } from "../../views/admin/components.js";
import {
  downgradeUser,
  upgradeUser,
  cancelSubscription,
  resetMonthlyCount,
} from "../../services/admin.js";

export const adminUserRoutes = new Hono();

const PER_PAGE = 25;

// ── User List ────────────────────────────────────────

adminUserRoutes.get("/", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const plan = c.req.query("plan") ?? "";
  const status = c.req.query("status") ?? "";
  const search = c.req.query("search") ?? "";
  const fragment = c.req.header("HX-Request") === "true";

  let query = supabase
    .from("users")
    .select("id, email, plan, subscription_status, monthly_summary_count, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

  if (plan) query = query.eq("plan", plan);
  if (status) query = query.eq("subscription_status", status);
  if (search) query = query.ilike("email", `%${search}%`);

  const { data: users, count, error } = await query;

  if (error) return c.text(`Error: ${error.message}`, 500);

  const buildUrl = (p?: number) => {
    const params = new URLSearchParams();
    if (plan) params.set("plan", plan);
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    if (p) params.set("page", String(p));
    const qs = params.toString();
    return `/api/admin/users${qs ? `?${qs}` : ""}`;
  };

  const content = (
    <div id="users-table">
      <div class="filters">
        <select
          name="plan"
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="">All plans</option>
          <option value="free" selected={plan === "free"}>
            Free
          </option>
          <option value="pro" selected={plan === "pro"}>
            Pro
          </option>
        </select>
        <select
          name="status"
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="">All statuses</option>
          <option value="active" selected={status === "active"}>
            Active
          </option>
          <option value="canceled" selected={status === "canceled"}>
            Canceled
          </option>
          <option value="past_due" selected={status === "past_due"}>
            Past due
          </option>
          <option value="none" selected={status === "none"}>
            None
          </option>
        </select>
        <input
          type="search"
          name="search"
          placeholder="Search by email..."
          value={search}
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-trigger="keyup changed delay:300ms"
          hx-include="[name]"
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Monthly Count</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u: any) => (
            <tr>
              <td>
                <a href={`/api/admin/users/${u.id}`}>{u.email}</a>
              </td>
              <td>
                <PlanBadge plan={u.plan} />
              </td>
              <td>
                <StatusBadge status={u.subscription_status} />
              </td>
              <td>{u.monthly_summary_count}</td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {(!users || users.length === 0) && (
            <tr>
              <td colspan="5" style="text-align:center;color:#999">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={page}
        total={count ?? 0}
        perPage={PER_PAGE}
        baseUrl={buildUrl()}
        targetId="users-table"
      />
    </div>
  );

  if (fragment) return c.html(content);

  return c.html(
    <AdminLayout title="Users">
      <h1>Users ({count ?? 0})</h1>
      {content}
    </AdminLayout>,
  );
});

// ── User Detail ──────────────────────────────────────

adminUserRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const { data: user, error } = await supabase.from("users").select("*").eq("id", id).single();

  if (error || !user) return c.text("User not found", 404);

  const { data: summaries } = await supabase
    .from("summaries")
    .select("id, video_title, status, created_at")
    .eq("user_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(0, 19);

  const { count: totalSummaries } = await supabase
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", id)
    .is("deleted_at", null);

  return c.html(
    <AdminLayout title={user.email}>
      <h1>{user.email}</h1>

      <div class="detail-grid section">
        <div class="card">
          <h2>Profile</h2>
          <div class="detail-row">
            <span class="label">Plan</span>
            <PlanBadge plan={user.plan} />
          </div>
          <div class="detail-row">
            <span class="label">Subscription</span>
            <StatusBadge status={user.subscription_status} />
          </div>
          <div class="detail-row">
            <span class="label">Stripe Customer</span>
            <span>{user.stripe_customer_id ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Stripe Sub</span>
            <span>{user.stripe_subscription_id ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Trial Ends</span>
            <span>{user.trial_ends_at ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Created</span>
            <span>{new Date(user.created_at).toLocaleString()}</span>
          </div>
        </div>

        <div class="card">
          <h2>Usage</h2>
          <div class="detail-row">
            <span class="label">Monthly Count</span>
            <span>{user.monthly_summary_count}</span>
          </div>
          <div class="detail-row">
            <span class="label">Reset At</span>
            <span>{user.monthly_count_reset_at}</span>
          </div>
          <div class="detail-row">
            <span class="label">Total Summaries</span>
            <span>{totalSummaries ?? 0}</span>
          </div>
        </div>
      </div>

      <div class="section" id="user-actions">
        <h2>Actions</h2>
        <div class="actions">
          {user.plan === "free" ? (
            <button
              class="btn btn-primary"
              hx-post={`/api/admin/users/${id}/upgrade`}
              hx-confirm="Upgrade this user to Pro (manual override, no Stripe checkout)?"
              hx-target="#user-actions"
              hx-swap="outerHTML"
            >
              Upgrade to Pro
            </button>
          ) : (
            <button
              class="btn btn-danger"
              hx-post={`/api/admin/users/${id}/downgrade`}
              hx-confirm="Downgrade this user to Free and cancel their subscription?"
              hx-target="#user-actions"
              hx-swap="outerHTML"
            >
              Downgrade to Free
            </button>
          )}
          {user.stripe_subscription_id && user.subscription_status === "active" && (
            <button
              class="btn btn-danger"
              hx-post={`/api/admin/users/${id}/cancel-subscription`}
              hx-confirm="Cancel this user's Stripe subscription?"
              hx-target="#user-actions"
              hx-swap="outerHTML"
            >
              Cancel Subscription
            </button>
          )}
          <button
            class="btn btn-secondary"
            hx-post={`/api/admin/users/${id}/reset-count`}
            hx-confirm="Reset monthly summary count to 0?"
            hx-target="#user-actions"
            hx-swap="outerHTML"
          >
            Reset Monthly Count
          </button>
        </div>
      </div>

      <div class="section">
        <h2>Recent Summaries</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(summaries ?? []).map((s: any) => (
              <tr>
                <td>
                  <a href={`/api/admin/summaries/${s.id}`}>{s.video_title ?? "Untitled"}</a>
                </td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>,
  );
});

// ── User Actions ─────────────────────────────────────

function actionResult(id: string, message: string, success: boolean) {
  return (
    <div class="section" id="user-actions">
      <h2>Actions</h2>
      <div class={success ? "success" : "error"}>{message}</div>
      <div class="actions">
        <a href={`/api/admin/users/${id}`} class="btn btn-secondary">
          Refresh page
        </a>
      </div>
    </div>
  );
}

adminUserRoutes.post("/:id/upgrade", async (c) => {
  const id = c.req.param("id");
  try {
    await upgradeUser(id);
    return c.html(actionResult(id, "User upgraded to Pro", true));
  } catch (err: any) {
    return c.html(actionResult(id, `Failed: ${err.message}`, false));
  }
});

adminUserRoutes.post("/:id/downgrade", async (c) => {
  const id = c.req.param("id");
  try {
    await downgradeUser(id);
    return c.html(actionResult(id, "User downgraded to Free", true));
  } catch (err: any) {
    return c.html(actionResult(id, `Failed: ${err.message}`, false));
  }
});

adminUserRoutes.post("/:id/cancel-subscription", async (c) => {
  const id = c.req.param("id");
  try {
    await cancelSubscription(id);
    return c.html(actionResult(id, "Subscription cancelled", true));
  } catch (err: any) {
    return c.html(actionResult(id, `Failed: ${err.message}`, false));
  }
});

adminUserRoutes.post("/:id/reset-count", async (c) => {
  const id = c.req.param("id");
  try {
    await resetMonthlyCount(id);
    return c.html(actionResult(id, "Monthly count reset to 0", true));
  } catch (err: any) {
    return c.html(actionResult(id, `Failed: ${err.message}`, false));
  }
});
```

- [ ] **Step 4: Mount user routes in admin index**

Update `apps/server/src/routes/admin/index.ts`:

```typescript
import { Hono } from "hono";
import { adminAuthMiddleware } from "./middleware.js";
import { loginRoutes } from "./login.js";
import { adminUserRoutes } from "./users.js";

export const adminRoutes = new Hono();

adminRoutes.use("*", adminAuthMiddleware);

adminRoutes.route("/login", loginRoutes);
adminRoutes.route("/users", adminUserRoutes);

adminRoutes.get("/", (c) => c.redirect("/api/admin/users"));
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/users.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin/users.tsx apps/server/src/routes/admin/index.ts apps/server/src/routes/admin/__tests__/users.test.ts
git commit -m "add admin users list and detail pages"
```

---

## Task 7: Summary Browser

**Files:**

- Create: `apps/server/src/routes/admin/summaries.tsx`
- Modify: `apps/server/src/routes/admin/index.ts`
- Create: `apps/server/src/routes/admin/__tests__/summaries.test.ts`

- [ ] **Step 1: Write tests**

`apps/server/src/routes/admin/__tests__/summaries.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.stubEnv("ADMIN_SECRET", "test-secret-123");

const mockFrom = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("../middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware.js")>();
  return {
    ...actual,
    adminAuthMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
  };
});

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, any> = {};
  const methods = [
    "select",
    "eq",
    "ilike",
    "or",
    "order",
    "range",
    "is",
    "not",
    "single",
    "gte",
    "lte",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminSummaryRoutes } = await import("../summaries.js");
  const app = new Hono();
  app.route("/admin/summaries", adminSummaryRoutes);
  return app;
}

describe("Admin Summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/summaries returns summary list page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "s1",
            video_title: "Test Video",
            status: "completed",
            tags: ["tag1"],
            created_at: "2026-01-01T00:00:00Z",
            users: { email: "test@example.com" },
          },
        ],
        count: 1,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/summaries");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Video");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/summaries.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement summary browser**

`apps/server/src/routes/admin/summaries.tsx`:

```tsx
import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatusBadge, Pagination } from "../../views/admin/components.js";

export const adminSummaryRoutes = new Hono();

const PER_PAGE = 25;

// ── Summary List ─────────────────────────────────────

adminSummaryRoutes.get("/", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const status = c.req.query("status") ?? "";
  const search = c.req.query("search") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const fragment = c.req.header("HX-Request") === "true";

  let query = supabase
    .from("summaries")
    .select("id, video_title, youtube_video_id, status, tags, created_at, users!inner(email)", {
      count: "exact",
    })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

  if (status) query = query.eq("status", status);
  if (search) {
    // Use separate filters to avoid PostgREST injection via commas/periods in search input
    const sanitized = search.replace(/[%_]/g, "\\$&");
    query = query.or(`video_title.ilike.%${sanitized}%,youtube_video_id.eq.${sanitized}`);
  }
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);

  const { data: summaries, count, error } = await query;

  if (error) return c.text(`Error: ${error.message}`, 500);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return `/api/admin/summaries${qs ? `?${qs}` : ""}`;
  };

  const content = (
    <div id="summaries-table">
      <div class="filters">
        <select
          name="status"
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="">All statuses</option>
          <option value="pending" selected={status === "pending"}>
            Pending
          </option>
          <option value="processing" selected={status === "processing"}>
            Processing
          </option>
          <option value="completed" selected={status === "completed"}>
            Completed
          </option>
          <option value="failed" selected={status === "failed"}>
            Failed
          </option>
        </select>
        <input
          type="date"
          name="from"
          value={from}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        />
        <input
          type="date"
          name="to"
          value={to}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        />
        <input
          type="search"
          name="search"
          placeholder="Search by title or video ID..."
          value={search}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-trigger="keyup changed delay:300ms"
          hx-include="[name]"
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>User</th>
            <th>Status</th>
            <th>Tags</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(summaries ?? []).map((s: any) => (
            <tr>
              <td>
                <a href={`/api/admin/summaries/${s.id}`}>
                  {s.video_title ?? s.youtube_video_id ?? "Untitled"}
                </a>
              </td>
              <td>{s.users?.email ?? "—"}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td>{(s.tags ?? []).join(", ") || "—"}</td>
              <td>{new Date(s.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {(!summaries || summaries.length === 0) && (
            <tr>
              <td colspan="5" style="text-align:center;color:#999">
                No summaries found
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={page}
        total={count ?? 0}
        perPage={PER_PAGE}
        baseUrl={buildUrl()}
        targetId="summaries-table"
      />
    </div>
  );

  if (fragment) return c.html(content);

  return c.html(
    <AdminLayout title="Summaries">
      <h1>Summaries ({count ?? 0})</h1>
      {content}
    </AdminLayout>,
  );
});

// ── Summary Detail ───────────────────────────────────

adminSummaryRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const { data: summary, error } = await supabase
    .from("summaries")
    .select("*, users!inner(email, plan)")
    .eq("id", id)
    .single();

  if (error || !summary) return c.text("Summary not found", 404);

  return c.html(
    <AdminLayout title={summary.video_title ?? "Summary Detail"}>
      <h1>{summary.video_title ?? "Untitled"}</h1>

      <div class="detail-grid section">
        <div class="card">
          <h2>Video Info</h2>
          <div class="detail-row">
            <span class="label">YouTube ID</span>
            <span>{summary.youtube_video_id}</span>
          </div>
          <div class="detail-row">
            <span class="label">Channel</span>
            <span>{summary.video_channel ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Duration</span>
            <span>
              {summary.video_duration_seconds
                ? `${Math.round(summary.video_duration_seconds / 60)}min`
                : "—"}
            </span>
          </div>
          <div class="detail-row">
            <span class="label">URL</span>
            <span>
              {summary.video_url ? (
                <a href={summary.video_url} target="_blank">
                  {summary.video_url}
                </a>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Status</span>
            <StatusBadge status={summary.status} />
          </div>
          <div class="detail-row">
            <span class="label">Tags</span>
            <span>{(summary.tags ?? []).join(", ") || "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Created</span>
            <span>{new Date(summary.created_at).toLocaleString()}</span>
          </div>
        </div>

        <div class="card">
          <h2>User</h2>
          <div class="detail-row">
            <span class="label">Email</span>
            <span>{summary.users?.email}</span>
          </div>
          <div class="detail-row">
            <span class="label">Plan</span>
            <span>{summary.users?.plan}</span>
          </div>
          <div class="detail-row">
            <span class="label">User ID</span>
            <span>
              <a href={`/api/admin/users/${summary.user_id}`}>{summary.user_id}</a>
            </span>
          </div>
        </div>
      </div>

      {summary.error_message && (
        <div class="section">
          <h2>Error</h2>
          <pre>{summary.error_message}</pre>
        </div>
      )}

      {summary.summary_json && (
        <div class="section">
          <h2>Summary JSON</h2>
          <pre>{JSON.stringify(summary.summary_json, null, 2)}</pre>
        </div>
      )}

      {summary.transcript && (
        <div class="section">
          <h2>Transcript (first 500 chars)</h2>
          <pre>
            {summary.transcript.slice(0, 500)}
            {summary.transcript.length > 500 ? "..." : ""}
          </pre>
        </div>
      )}
    </AdminLayout>,
  );
});
```

- [ ] **Step 4: Mount summary routes in admin index**

Update `apps/server/src/routes/admin/index.ts` — add:

```typescript
import { adminSummaryRoutes } from "./summaries.js";
// ...
adminRoutes.route("/summaries", adminSummaryRoutes);
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/summaries.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin/summaries.tsx apps/server/src/routes/admin/index.ts apps/server/src/routes/admin/__tests__/summaries.test.ts
git commit -m "add admin summary browser and detail view"
```

---

## Task 8: Queue Monitor

**Files:**

- Create: `apps/server/src/routes/admin/queue.tsx`
- Modify: `apps/server/src/routes/admin/index.ts`
- Create: `apps/server/src/routes/admin/__tests__/queue.test.ts`

- [ ] **Step 1: Write tests**

`apps/server/src/routes/admin/__tests__/queue.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.stubEnv("ADMIN_SECRET", "test-secret-123");

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("../middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware.js")>();
  return {
    ...actual,
    adminAuthMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
  };
});

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: Record<string, any> = {};
  const methods = [
    "select",
    "eq",
    "ilike",
    "or",
    "order",
    "range",
    "is",
    "not",
    "single",
    "gte",
    "lte",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminQueueRoutes } = await import("../queue.js");
  const app = new Hono();
  app.route("/admin/queue", adminQueueRoutes);
  return app;
}

describe("Admin Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/queue returns queue dashboard", async () => {
    // Mock: first call for stats (pending), second for recent items
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
        // stats queries
        return mockChain({
          count: callCount === 1 ? 5 : callCount === 2 ? 2 : callCount === 3 ? 1 : 10,
        });
      }
      // recent items
      return mockChain({
        data: [
          {
            id: "s1",
            video_title: "Test",
            status: "pending",
            created_at: "2026-01-01T00:00:00Z",
            users: { email: "test@example.com" },
          },
        ],
      });
    });

    const app = await createApp();
    const res = await app.request("/admin/queue");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Queue");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/queue.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement queue monitor**

`apps/server/src/routes/admin/queue.tsx`:

```tsx
import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatsCard, StatusBadge } from "../../views/admin/components.js";

export const adminQueueRoutes = new Hono();

// ── Queue Dashboard ──────────────────────────────────

adminQueueRoutes.get("/", async (c) => {
  const fragment = c.req.header("HX-Request") === "true";

  // Get counts by status
  const [pending, processing, failed, completedToday] = await Promise.all([
    supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .is("deleted_at", null),
    supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .is("deleted_at", null),
    supabase
      .from("summaries")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .is("deleted_at", null)
      .gte("created_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()),
  ]);

  // Recent items
  const { data: recent } = await supabase
    .from("summaries")
    .select("id, video_title, youtube_video_id, status, created_at, users!inner(email)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(0, 49);

  const content = (
    <div id="queue-content">
      <div
        class="stats-grid"
        hx-get="/api/admin/queue"
        hx-trigger="every 10s"
        hx-target="#queue-content"
        hx-swap="outerHTML"
        hx-select="#queue-content"
      >
        <StatsCard label="Pending" value={pending.count ?? 0} badge="pending" />
        <StatsCard label="Processing" value={processing.count ?? 0} badge="processing" />
        <StatsCard label="Failed" value={failed.count ?? 0} badge="failed" />
        <StatsCard label="Completed Today" value={completedToday.count ?? 0} badge="completed" />
      </div>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>User</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(recent ?? []).map((s: any) => (
            <tr>
              <td>
                <a href={`/api/admin/summaries/${s.id}`}>
                  {s.video_title ?? s.youtube_video_id ?? "Untitled"}
                </a>
              </td>
              <td>{s.users?.email ?? "—"}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td>{new Date(s.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (fragment) return c.html(content);

  return c.html(
    <AdminLayout title="Queue">
      <h1>Queue Monitor</h1>
      {content}
    </AdminLayout>,
  );
});
```

- [ ] **Step 4: Mount queue routes in admin index**

Update `apps/server/src/routes/admin/index.ts` — add:

```typescript
import { adminQueueRoutes } from "./queue.js";
// ...
adminRoutes.route("/queue", adminQueueRoutes);
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit -- apps/server/src/routes/admin/__tests__/queue.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin/queue.tsx apps/server/src/routes/admin/index.ts apps/server/src/routes/admin/__tests__/queue.test.ts
git commit -m "add admin queue monitor dashboard"
```

---

## Task 9: Integration Test & Final Verification

**Files:**

- No new files — verification only

- [ ] **Step 1: Run all admin tests**

Run: `pnpm test:unit -- apps/server/src/routes/admin/`
Expected: All tests pass

- [ ] **Step 2: Run full test suite**

Run: `pnpm test:unit`
Expected: All existing tests still pass (no regressions)

- [ ] **Step 3: Run lint and format**

Run: `pnpm lint && pnpm format`
Expected: No errors

- [ ] **Step 4: Build for production**

Run: `pnpm --filter server build` (or `bash scripts/build-vercel.sh` after setting up output dirs)
Expected: Build succeeds with no errors

- [ ] **Step 5: Manual smoke test locally**

Run: `pnpm dev:server`

1. Visit `http://localhost:3000/api/admin/login` — should show login form
2. Enter the `ADMIN_SECRET` value — should redirect to `/api/admin/users`
3. Users page should show the user table with filters
4. Click a user — should show detail page with actions
5. Visit `/api/admin/summaries` — should show summary browser
6. Visit `/api/admin/queue` — should show stats cards and recent items
7. Verify HTMX filtering works (type in search, change dropdown)

- [ ] **Step 6: Set ADMIN_SECRET on Vercel**

Run: `printf '%s' 'your-strong-secret-here' | vercel env add ADMIN_SECRET production preview development`

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix admin console issues from smoke testing"
```
