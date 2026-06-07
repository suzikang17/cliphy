import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    // Capture 100% of transactions. httpIntegration (on by default) auto-creates
    // a transaction per incoming request; initSentry() runs before any http import
    // so the instrumentation hooks correctly. sendDefaultPii stays off (default).
    tracesSampleRate: 1.0,
  });
}

export { Sentry };
