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
