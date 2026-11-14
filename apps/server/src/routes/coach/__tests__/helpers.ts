import { vi } from "vitest";

/** One database call as the code under test made it. */
export interface Op {
  table: string;
  action: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: unknown;
  options?: unknown;
  filters: [string, string, unknown][];
  single: boolean;
}

export interface Result {
  data?: unknown;
  error?: unknown;
}

export type Responder = (op: Op) => Result | undefined;

/**
 * A recording stand-in for the Supabase client. Every awaited query is pushed
 * to `ops`; `respond` decides what it returns (default: `{ data: null, error: null }`).
 */
export function makeDb(respond: Responder = () => undefined) {
  const ops: Op[] = [];
  const db = {
    ops,
    respond,
    from(table: string) {
      const op: Op = { table, action: "select", filters: [], single: false };
      const chain: Record<string, unknown> = {};
      const passthrough = ["select", "order", "limit", "range"];
      for (const m of passthrough) chain[m] = () => chain;
      for (const m of ["eq", "neq", "in", "is", "like", "gte", "lte", "not"]) {
        chain[m] = (col: string, val: unknown) => {
          op.filters.push([m, col, val]);
          return chain;
        };
      }
      chain.insert = (payload: unknown) => {
        op.action = "insert";
        op.payload = payload;
        return chain;
      };
      chain.upsert = (payload: unknown, options?: unknown) => {
        op.action = "upsert";
        op.payload = payload;
        op.options = options;
        return chain;
      };
      chain.update = (payload: unknown) => {
        op.action = "update";
        op.payload = payload;
        return chain;
      };
      chain.delete = () => {
        op.action = "delete";
        return chain;
      };
      chain.single = () => {
        op.single = true;
        return chain;
      };
      chain.maybeSingle = chain.single;
      chain.then = (resolve: (r: Result) => void) => {
        ops.push(op);
        resolve({ data: null, error: null, ...(db.respond(op) ?? {}) });
      };
      return chain;
    },
    /** Payloads written to a table, in order. */
    written(table: string, action?: Op["action"]): unknown[] {
      return ops
        .filter(
          (o) => o.table === table && o.action !== "select" && (!action || o.action === action),
        )
        .map((o) => o.payload);
    },
    writtenTables(): string[] {
      return [...new Set(ops.filter((o) => o.action !== "select").map((o) => o.table))];
    },
  };
  return db;
}

export type FakeDb = ReturnType<typeof makeDb>;

/** The value an `eq` filter on `col` was called with, if any. */
export function eqValue(op: Op, col: string): unknown {
  return op.filters.find(([m, c]) => m === "eq" && c === col)?.[2];
}

export const passAuth = {
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
};

export const passCoach = {
  requireCoach: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
};

export function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
