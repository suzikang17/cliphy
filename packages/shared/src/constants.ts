import type { PlanTier } from "./types.js";

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 5,
  pro: 100,
};

export const API_ROUTES = {
  AUTH: {
    CALLBACK: "/api/auth/callback",
    ME: "/api/auth/me",
  },
  QUEUE: {
    LIST: "/api/queue",
    ADD: "/api/queue",
    ITEM: (id: string) => `/api/queue/${id}`,
    PROCESS: (id: string) => `/api/queue/${id}/process`,
  },
  SUMMARIES: {
    LIST: "/api/summaries",
    ITEM: (id: string) => `/api/summaries/${id}`,
  },
  USAGE: {
    INFO: "/api/usage",
  },
  BILLING: {
    CHECKOUT: "/api/billing/checkout",
    PORTAL: "/api/billing/portal",
    WEBHOOK: "/api/billing/webhook",
  },
} as const;

export const SUMMARY_STATUSES = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
