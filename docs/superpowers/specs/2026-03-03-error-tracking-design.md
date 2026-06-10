# Error Tracking with Sentry

## Goal

Know when things break in production. Capture unhandled errors on server and extension, alert via Discord, and replace ad-hoc console.log calls with structured logging.

## Scope

- **Errors only** — no performance tracing (`tracesSampleRate: 0`)
- **Server + extension** — not the content script (too noisy, YouTube DOM changes)
- **Structured logging** — JSON logger with context, replaces raw console.log/error
- **Alerting** — email + Discord (separate `#server-errors` and `#extension-errors` channels)

## Sentry Setup

Two Sentry projects in one org:

| Project            | Platform   | DSN Env Var       |
| ------------------ | ---------- | ----------------- |
| `cliphy-server`    | Node.js    | `SENTRY_DSN`      |
| `cliphy-extension` | Browser JS | `VITE_SENTRY_DSN` |

Free tier: 5k errors/mo. No performance tracing keeps quota low.

## Server

### Init

New file `apps/server/src/lib/sentry.ts`:

- `Sentry.init({ dsn, tracesSampleRate: 0, environment })`
- Import at top of `app.ts` before routes

### Hono error handler

```typescript
app.onError((err, c) => {
  Sentry.captureException(err);
  return c.json({ error: "Internal server error" }, 500);
});
```

Catches anything that slips past route-level try/catch.

### Inngest failures

In `summarize-video.ts` `onFailure` handler, report to Sentry with context:

```typescript
Sentry.captureException(error, {
  extra: { videoId, summaryId },
});
```

### Structured logger

New file `apps/server/src/lib/logger.ts`:

```typescript
interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private context: LogContext;

  child(ctx: LogContext): Logger {
    /* returns new Logger with merged context */
  }
  info(message: string, extra?: LogContext): void {
    /* JSON to stdout + Sentry breadcrumb */
  }
  warn(message: string, extra?: LogContext): void {
    /* JSON to stdout + Sentry breadcrumb */
  }
  error(message: string, error?: Error, extra?: LogContext): void {
    /* JSON to stderr + Sentry breadcrumb */
  }
}

export const logger = new Logger();
```

Output format: `{ level, message, timestamp, ...context }`

Replace all existing `console.log("[tag] ...")` and `console.error(...)` calls:

| File                 | Current                                                  | After                                                           |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `summarize-video.ts` | `console.log("[summarize-video] Transcript fetched...")` | `log.info("Transcript fetched", { videoId, chars, truncated })` |
| `transcript.ts`      | `console.log("[transcript] videoId=...")`                | `log.info("Fetching transcript", { videoId, method })`          |
| `billing.ts`         | `console.error("Checkout: user lookup failed...")`       | `log.error("User lookup failed", err, { userId })`              |

## Extension

### Init

Shared config in `apps/extension/lib/sentry.ts`:

```typescript
export function initSentry() {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tracesSampleRate: 0,
    environment: import.meta.env.MODE,
  });
}
```

Called in each entrypoint:

- `entrypoints/background.ts`
- `entrypoints/sidepanel/main.tsx`
- `entrypoints/summaries/main.tsx`

### React Error Boundary

Wrap `<App />` in both sidepanel and summaries:

```tsx
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</Sentry.ErrorBoundary>
```

`ErrorFallback`: simple "Something went wrong" message with a reload button.

### API client

In `lib/api.ts` `request()`, report unexpected errors to Sentry:

- **Report**: 5xx responses, network failures (TypeError)
- **Don't report**: 401 (AuthError), 402 (ProRequiredError), 429 (RateLimitError), 403 TAG_LIMIT — these are expected

### Background script

In `runtime.onMessage` catch block, call `Sentry.captureException()` for unexpected errors only (not RateLimitError, ProRequiredError, etc).

### Source maps

Upload source maps to Sentry during build:

- `@sentry/cli` uploads `.output/chrome-mv3` source maps
- Add to `pnpm build:extension` pipeline
- Enables readable stack traces in Sentry dashboard

## Alerting

### Discord

- Discord server with two channels: `#server-errors`, `#extension-errors`
- Connect Sentry → Discord via native integration (Sentry Settings → Integrations → Discord)

### Alert rules (both projects)

| Trigger                                | Action          |
| -------------------------------------- | --------------- |
| New issue (first seen)                 | Discord + email |
| Issue regression (resolved → recurred) | Discord + email |

No volume-based alerts. No performance alerts.

## Env Vars

| Variable            | Where                 | Value                  |
| ------------------- | --------------------- | ---------------------- |
| `SENTRY_DSN`        | Vercel (all envs)     | Server project DSN     |
| `VITE_SENTRY_DSN`   | `apps/extension/.env` | Extension project DSN  |
| `SENTRY_AUTH_TOKEN` | CI / local            | For source map uploads |

## Out of Scope

- Performance monitoring / tracing
- Session replay
- Content script error capture
- Custom dashboards
- Log aggregation service (Sentry breadcrumbs are enough for now)
