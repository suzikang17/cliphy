import type { PlanTier } from "./types.js";

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 5,
  pro: 100,
};

/** Number of days of history visible to free users. */
export const FREE_HISTORY_DAYS = 7;

/** Stripe payment link / upgrade page URL. */
export const UPGRADE_URL = "https://cliphy.app/pricing";

/** Pro-only feature identifiers for consistent gating. */
export const PRO_FEATURES = {
  BATCH_QUEUE: "batch_queue",
  UNLIMITED_HISTORY: "unlimited_history",
  DEEP_DIVE: "deep_dive",
  CUSTOM_PROMPTS: "custom_prompts",
  EXPORT: "export",
  PRIORITY_PROCESSING: "priority_processing",
} as const;

export type ProFeature = (typeof PRO_FEATURES)[keyof typeof PRO_FEATURES];

export const API_ROUTES = {
  AUTH: {
    CALLBACK: "/api/auth/callback",
    ME: "/api/auth/me",
  },
  QUEUE: {
    LIST: "/api/queue",
    ADD: "/api/queue",
    ITEM: (id: string) => `/api/queue/${id}`,
    RETRY: (id: string) => `/api/queue/${id}/retry`,
    BATCH: "/api/queue/batch",
  },
  SUMMARIES: {
    LIST: "/api/summaries",
    ITEM: (id: string) => `/api/summaries/${id}`,
    SEARCH: "/api/summaries/search",
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
