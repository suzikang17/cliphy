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
