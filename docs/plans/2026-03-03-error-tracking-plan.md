# Error Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Sentry error tracking to server and extension with structured logging and Discord alerts.

**Architecture:** Two Sentry projects (cliphy-server, cliphy-extension). Server uses `@sentry/node` with Hono's built-in error handler. Extension uses `@sentry/react` for React pages and manual `BrowserClient` for the background service worker. A thin structured logger replaces all `console.log/error` calls on the server.

**Tech Stack:** `@sentry/node` (server), `@sentry/react` + `@sentry/browser` (extension), `@sentry/cli` (source maps)

**Design doc:** `docs/plans/2026-03-03-error-tracking-design.md`

---

### Task 1: Install server dependencies and create Sentry init

**Files:**

- Create: `apps/server/src/lib/sentry.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/vercel.ts`

**Step 1: Install `@sentry/node`**

```bash
pnpm --filter server add @sentry/node
```

**Step 2: Create Sentry init module**

Create `apps/server/src/lib/sentry.ts`:

```typescript
import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
  });
}

export { Sentry };
```

**Step 3: Import Sentry init in entry files**

In `apps/server/src/index.ts`, add at the very top (before other imports):

```typescript
import { initSentry } from "./lib/sentry.js";
initSentry();
```

In `apps/server/src/vercel.ts`, add at the very top:

```typescript
import { initSentry } from "./lib/sentry.js";
initSentry();
```

**Step 4: Add Hono error handler in `apps/server/src/app.ts`**

After the last `app.route(...)` call and before `app.get("/health", ...)`, add:

```typescript
import { Sentry } from "./lib/sentry.js";

// ... after all routes ...

app.onError((err, c) => {
  Sentry.captureException(err);
  return c.json({ error: "Internal server error" }, 500);
});
```

**Step 5: Verify**

```bash
pnpm --filter server typecheck
pnpm build:server
```

Expected: Both pass. Sentry is a no-op without `SENTRY_DSN` set.

**Step 6: Commit**

```bash
git add apps/server/src/lib/sentry.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/src/vercel.ts apps/server/package.json pnpm-lock.yaml
git commit -m "add Sentry init and Hono error handler for server"
```

---

### Task 2: Create structured logger

**Files:**

- Create: `apps/server/src/lib/logger.ts`

**Step 1: Create the logger module**

Create `apps/server/src/lib/logger.ts`:

```typescript
import * as Sentry from "@sentry/node";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  child(ctx: LogContext): Logger {
    return new Logger({ ...this.context, ...ctx });
  }

  info(message: string, extra?: LogContext): void {
    const merged = { ...this.context, ...extra };
    console.log(JSON.stringify({ level: "info", message, ...merged }));
    Sentry.addBreadcrumb({ message, data: merged, level: "info" });
  }

  warn(message: string, extra?: LogContext): void {
    const merged = { ...this.context, ...extra };
    console.warn(JSON.stringify({ level: "warn", message, ...merged }));
    Sentry.addBreadcrumb({ message, data: merged, level: "warning" });
  }

  error(message: string, err?: Error, extra?: LogContext): void {
    const merged = { ...this.context, ...extra };
    if (err) merged.error = err.message;
    console.error(JSON.stringify({ level: "error", message, ...merged }));
    Sentry.addBreadcrumb({ message, data: merged, level: "error" });
  }
}

export const logger = new Logger();
```

**Step 2: Verify**

```bash
pnpm --filter server typecheck
```

Expected: Pass.

**Step 3: Commit**

```bash
git add apps/server/src/lib/logger.ts
git commit -m "add structured JSON logger with Sentry breadcrumbs"
```

---

### Task 3: Migrate server console calls to structured logger

**Files:**

- Modify: `apps/server/src/index.ts` (1 call)
- Modify: `apps/server/src/services/transcript.ts` (1 call)
- Modify: `apps/server/src/functions/summarize-video.ts` (1 call)
- Modify: `apps/server/src/routes/billing.ts` (6 calls)

**Step 1: Migrate each file**

`apps/server/src/index.ts:5`:

```typescript
// Before:
console.log(`Server running on http://localhost:${port}`);
// After:
import { logger } from "./lib/logger.js";
logger.info("Server running", { port });
```

`apps/server/src/services/transcript.ts:85`:

```typescript
// Before:
console.log(`[transcript] videoId=${videoId} ...`);
// After:
import { logger } from "../lib/logger.js";
// Use logger.info() with structured context instead of string interpolation
```

`apps/server/src/functions/summarize-video.ts:34`:

```typescript
// Before:
console.log(`[summarize-video] Transcript fetched for ${videoId}: ...`);
// After:
import { logger } from "../lib/logger.js";
const log = logger.child({ fn: "summarize-video" });
log.info("Transcript fetched", {
  videoId,
  chars: transcript.text.length,
  truncated: transcript.truncated,
});
```

`apps/server/src/routes/billing.ts` — 6 calls:

```typescript
import { logger } from "../lib/logger.js";
const log = logger.child({ route: "billing" });

// Line 25: console.error(`Checkout: user lookup failed...`) →
log.error("User lookup failed", error, { userId });

// Line 43: console.error(`Checkout: Stripe error...`) →
log.error("Stripe checkout error", new Error(message), { userId });

// Line 166: console.error(`Failed to sync subscription...`) →
log.error("Subscription sync failed", error, { subscriptionId: subscription.id });

// Line 208: console.error(`Webhook signature verification failed...`) →
log.error("Webhook signature verification failed", new Error(message));

// Line 212: console.log(`Stripe webhook received...`) →
log.info("Webhook received", { type: event.type });

// Line 226: console.log(`Unhandled event type...`) →
log.warn("Unhandled webhook event", { type: event.type });
```

**Step 2: Verify**

```bash
pnpm --filter server typecheck
pnpm test:unit -- --run
```

Expected: Both pass. Logger is a drop-in replacement.

**Step 3: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/services/transcript.ts apps/server/src/functions/summarize-video.ts apps/server/src/routes/billing.ts
git commit -m "migrate server console calls to structured logger"
```

---

### Task 4: Add Sentry to Inngest onFailure handler

**Files:**

- Modify: `apps/server/src/functions/summarize-video.ts`

**Step 1: Report to Sentry in onFailure**

In the `onFailure` handler (lines 11-18), add Sentry capture after the DB update:

```typescript
import { Sentry } from "../lib/sentry.js";

onFailure: async ({ event }) => {
  const { summaryId } = event.data.event.data as { summaryId: string };
  const errorMessage = event.data.error.message || "Failed to generate summary";

  Sentry.captureException(new Error(errorMessage), {
    extra: {
      summaryId,
      videoId: (event.data.event.data as { videoId?: string }).videoId,
    },
    tags: { component: "inngest" },
  });

  await supabase
    .from("summaries")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", summaryId);
},
```

**Step 2: Verify**

```bash
pnpm --filter server typecheck
pnpm test:unit -- --run
```

Expected: Both pass. Tests mock Inngest so Sentry import is harmless.

**Step 3: Commit**

```bash
git add apps/server/src/functions/summarize-video.ts
git commit -m "report Inngest job failures to Sentry"
```

---

### Task 5: Install extension dependencies and create Sentry init

**Files:**

- Create: `apps/extension/lib/sentry.ts`

**Step 1: Install packages**

```bash
pnpm --filter extension add @sentry/react @sentry/browser
```

**Step 2: Create extension Sentry module**

Create `apps/extension/lib/sentry.ts`:

```typescript
import * as Sentry from "@sentry/react";
import {
  BrowserClient,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport,
  Scope,
} from "@sentry/browser";

/** Initialize Sentry for React pages (sidepanel, summaries). */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });
}

/**
 * Create a standalone Sentry client for the background service worker.
 * Service workers don't have `window`, so we can't use Sentry.init() which
 * attaches global error handlers. Returns a Scope for manual capture.
 */
export function createBackgroundClient(): Scope | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return null;

  const integrations = getDefaultIntegrations({}).filter(
    (i) => !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(i.name),
  );

  const client = new BrowserClient({
    dsn,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });

  const scope = new Scope();
  scope.setClient(client);
  client.init();
  return scope;
}

export { Sentry };
```

**Step 3: Verify**

```bash
pnpm --filter extension typecheck
```

Expected: Pass.

**Step 4: Commit**

```bash
git add apps/extension/lib/sentry.ts apps/extension/package.json pnpm-lock.yaml
git commit -m "add Sentry init for extension (React pages + background SW)"
```

---

### Task 6: Add Sentry error boundary to React pages

**Files:**

- Modify: `apps/extension/entrypoints/sidepanel/main.tsx`
- Modify: `apps/extension/entrypoints/summaries/main.tsx`
- Create: `apps/extension/components/ErrorFallback.tsx`

**Step 1: Create ErrorFallback component**

Create `apps/extension/components/ErrorFallback.tsx`:

```tsx
export function ErrorFallback() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-center">
      <p className="text-sm font-bold">Something went wrong</p>
      <p className="text-xs text-(--color-text-faint) mt-1">An unexpected error occurred.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs font-bold px-4 py-2 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
      >
        Reload
      </button>
    </div>
  );
}
```

**Step 2: Wrap sidepanel in error boundary**

Modify `apps/extension/entrypoints/sidepanel/main.tsx`:

```tsx
import "../../assets/main.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Sentry, initSentry } from "../../lib/sentry";
import { ErrorFallback } from "../../components/ErrorFallback";
import { App } from "./App";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
```

**Step 3: Wrap summaries page in error boundary**

Modify `apps/extension/entrypoints/summaries/main.tsx` — same pattern as sidepanel.

**Step 4: Verify**

```bash
pnpm --filter extension typecheck
pnpm build:extension
```

Expected: Both pass. Without `VITE_SENTRY_DSN`, Sentry is a no-op.

**Step 5: Commit**

```bash
git add apps/extension/components/ErrorFallback.tsx apps/extension/entrypoints/sidepanel/main.tsx apps/extension/entrypoints/summaries/main.tsx
git commit -m "add React error boundary with Sentry for extension pages"
```

---

### Task 7: Add Sentry to background script

**Files:**

- Modify: `apps/extension/entrypoints/background.ts`

**Step 1: Initialize background Sentry client**

At the top of `background.ts`, after existing imports:

```typescript
import { createBackgroundClient } from "../lib/sentry";

const sentryScope = createBackgroundClient();
```

**Step 2: Report unexpected errors in message handler**

In the ADD_TO_QUEUE catch block (line ~100), after the existing error handling, add Sentry capture for unexpected errors:

```typescript
} else {
  // Unexpected error — report to Sentry
  sentryScope?.captureException(err instanceof Error ? err : new Error(String(err)));
  sendResponse({
    success: false,
    error: err instanceof Error ? err.message : "Unknown error",
  });
}
```

In the context menu catch block (line ~63):

```typescript
} catch (err) {
  sentryScope?.captureException(err instanceof Error ? err : new Error(String(err)));
  console.error("[Cliphy] Context menu queue failed:", err);
}
```

Don't report `RateLimitError` or `ProRequiredError` — they're expected.

**Step 3: Verify**

```bash
pnpm --filter extension typecheck
pnpm build:extension
```

Expected: Both pass.

**Step 4: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "add Sentry error capture to background script"
```

---

### Task 8: Add Sentry to API client for unexpected errors

**Files:**

- Modify: `apps/extension/lib/api.ts`

**Step 1: Report unexpected errors in `request()` function**

Import Sentry at top of `api.ts`:

```typescript
import { Sentry } from "./sentry";
```

In the `request()` function, after the network error catch (the `TypeError` → "You're offline" case), add Sentry capture:

```typescript
// Network error
catch (err) {
  if (err instanceof TypeError) {
    throw new Error("You're offline. Check your connection and try again.");
  }
  Sentry.captureException(err);
  throw err;
}
```

After the generic error throw at the end of `request()` (the `throw new Error(body.error || ...)` fallback for non-4xx errors), add capture before throwing:

```typescript
// For 5xx and other unexpected status codes, report to Sentry
if (res.status >= 500) {
  Sentry.captureException(new Error(body.error || `Request failed: ${res.status}`), {
    extra: { status: res.status, path },
  });
}
```

Don't capture 401, 402, 403, 429 — those are already handled by custom error classes.

**Step 2: Verify**

```bash
pnpm --filter extension typecheck
```

Expected: Pass.

**Step 3: Commit**

```bash
git add apps/extension/lib/api.ts
git commit -m "report unexpected API errors to Sentry from extension"
```

---

### Task 9: Source map upload for extension

**Files:**

- Modify: `apps/extension/package.json` (build script)

**Step 1: Install Sentry CLI**

```bash
pnpm --filter extension add -D @sentry/cli
```

**Step 2: Add source map upload to build**

Add a `postbuild` script to `apps/extension/package.json` or a standalone script. The simplest approach is a script that runs after `wxt build`:

Create `apps/extension/scripts/upload-sourcemaps.sh`:

```bash
#!/bin/bash
# Upload source maps to Sentry after extension build
# Requires SENTRY_AUTH_TOKEN and SENTRY_ORG env vars

if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "Skipping source map upload (SENTRY_AUTH_TOKEN not set)"
  exit 0
fi

npx @sentry/cli sourcemaps inject .output/chrome-mv3
npx @sentry/cli sourcemaps upload .output/chrome-mv3 \
  --org "$SENTRY_ORG" \
  --project cliphy-extension
```

**Step 3: Verify**

Without `SENTRY_AUTH_TOKEN` set, the script exits cleanly. Test with:

```bash
bash apps/extension/scripts/upload-sourcemaps.sh
```

Expected: "Skipping source map upload"

**Step 4: Commit**

```bash
git add apps/extension/scripts/upload-sourcemaps.sh apps/extension/package.json pnpm-lock.yaml
git commit -m "add source map upload script for Sentry"
```

---

### Task 10: Update env vars and documentation

**Files:**

- Modify: `.env.example`
- Modify: Vercel env vars (manual step)

**Step 1: Update `.env.example`**

Add to `.env.example`:

```
# Sentry
SENTRY_DSN=
VITE_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
```

**Step 2: Manual — Create Sentry projects**

1. Sign up at sentry.io (or log in)
2. Create org (e.g. `cliphy`)
3. Create project `cliphy-server` (Node.js platform)
4. Create project `cliphy-extension` (Browser JavaScript platform)
5. Copy DSNs

**Step 3: Manual — Set env vars**

- Vercel: Add `SENTRY_DSN` to all environments (Production, Preview, Development)
- Extension `.env`: Add `VITE_SENTRY_DSN`
- Local `.env`: Add both DSNs + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`

**Step 4: Manual — Set up Discord integration**

1. Create Discord server (or use existing)
2. Create channels: `#server-errors`, `#extension-errors`
3. In Sentry: Settings → Integrations → Discord → Install
4. Create alert rules for each project:
   - When: A new issue is created → Send to Discord `#server-errors` / `#extension-errors`
   - When: An issue changes state from resolved to unresolved → Same channels

**Step 5: Commit**

```bash
git add .env.example
git commit -m "add Sentry env vars to .env.example"
```

---

### Task 11: Full verification

**Step 1: Run full CI suite**

```bash
pnpm exec prettier --check .
pnpm lint
pnpm --filter shared typecheck
pnpm --filter extension typecheck
pnpm --filter server typecheck
pnpm build:extension
pnpm build:server
pnpm test:unit -- --run
```

Expected: All pass.

**Step 2: Smoke test server Sentry**

With `SENTRY_DSN` set locally:

```bash
pnpm dev:server
# In another terminal:
curl http://localhost:3001/api/debug-sentry
```

(Add a temporary test route that throws, verify it appears in Sentry dashboard, then remove it.)

**Step 3: Smoke test extension Sentry**

Load the built extension, open sidepanel, check browser console for no Sentry init errors.

**Step 4: Final commit if any fixes needed**

---

## Summary of new/modified files

| #   | File                                            | Action                                |
| --- | ----------------------------------------------- | ------------------------------------- |
| 1   | `apps/server/src/lib/sentry.ts`                 | Create                                |
| 2   | `apps/server/src/lib/logger.ts`                 | Create                                |
| 3   | `apps/server/src/app.ts`                        | Modify (add onError + Sentry import)  |
| 4   | `apps/server/src/index.ts`                      | Modify (add initSentry + logger)      |
| 5   | `apps/server/src/vercel.ts`                     | Modify (add initSentry)               |
| 6   | `apps/server/src/functions/summarize-video.ts`  | Modify (onFailure + logger)           |
| 7   | `apps/server/src/services/transcript.ts`        | Modify (logger)                       |
| 8   | `apps/server/src/routes/billing.ts`             | Modify (logger)                       |
| 9   | `apps/extension/lib/sentry.ts`                  | Create                                |
| 10  | `apps/extension/components/ErrorFallback.tsx`   | Create                                |
| 11  | `apps/extension/entrypoints/sidepanel/main.tsx` | Modify (Sentry init + error boundary) |
| 12  | `apps/extension/entrypoints/summaries/main.tsx` | Modify (Sentry init + error boundary) |
| 13  | `apps/extension/entrypoints/background.ts`      | Modify (background client + capture)  |
| 14  | `apps/extension/lib/api.ts`                     | Modify (capture unexpected errors)    |
| 15  | `apps/extension/scripts/upload-sourcemaps.sh`   | Create                                |
| 16  | `.env.example`                                  | Modify (add Sentry vars)              |
