import type { PlanTier } from "./types";

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 5,
  pro: 100,
};

/** Number of days of history visible to free users. */
export const FREE_HISTORY_DAYS = 7;

/** Maximum video duration in seconds (4 hours). Videos longer than this are rejected. */
export const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60;

/** Maximum number of tags per summary. */
export const MAX_TAGS_PER_SUMMARY = 10;

/** Maximum unique tags across all summaries for free users. */
export const MAX_FREE_UNIQUE_TAGS = 3;

/** Maximum character length for a single tag. */
export const TAG_MAX_LENGTH = 30;

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
  AUTO_TAG: "auto_tag",
  VIDEO_CHAT: "video_chat",
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
    TAGS: (id: string) => `/api/summaries/${id}/tags`,
    SEARCH: "/api/summaries/search",
    AUTO_TAG: (id: string) => `/api/summaries/${id}/auto-tag`,
    AUTO_TAG_BULK: "/api/summaries/auto-tag/bulk",
    CHAT: (id: string) => `/api/summaries/${id}/chat`,
    UPDATE: (id: string) => `/api/summaries/${id}`,
  },
  TAGS: {
    LIST: "/api/summaries/tags",
  },
  USAGE: {
    INFO: "/api/usage",
  },
  BILLING: {
    CHECKOUT: "/api/billing/checkout",
    PORTAL: "/api/billing/portal",
    WEBHOOK: "/api/billing/webhook",
  },
  SETTINGS: "/api/settings",
} as const;

export const WEB_ROUTES = {
  DASHBOARD: "/dashboard",
  LOGIN: "/login",
  SUMMARY: (id: string) => `/summary/${id}`,
  PRICING: "/pricing",
  TERMS: "/terms",
  PRIVACY: "/privacy",
} as const;

export const SUMMARY_STATUSES = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const SUMMARY_LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  it: "Italian",
  ru: "Russian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  uk: "Ukrainian",
  sv: "Swedish",
} as const;

export type SummaryLanguageCode = keyof typeof SUMMARY_LANGUAGES;
