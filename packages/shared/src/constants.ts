import type { PlanTier } from "./types";

export const PLAN_LIMITS: Record<PlanTier, number> = {
  free: 5,
  pro: 100,
};

/** Number of days of history visible to free users. */
export const FREE_HISTORY_DAYS = 7;

/** Maximum video duration in seconds (4 hours). Videos longer than this are rejected. */
export const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60;

/**
 * Dedup window for queueing the same video. Two enqueues of the same (user,
 * video) within this many seconds are treated as an accidental duplicate
 * (e.g. the OS share sheet firing the handler multiple times) and collapsed to
 * one. Enqueues further apart are allowed, so a user can re-summarize a video
 * later. Used both for the sliding-window check and the bucket the atomic
 * unique index is keyed on.
 */
export const DEDUP_WINDOW_SECONDS = 60;

/** Maximum number of tags per summary. */
export const MAX_TAGS_PER_SUMMARY = 10;

/** Maximum length (characters) of user notes on a summary. */
export const MAX_NOTES_LENGTH = 10000;

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
  AUTO_SUBSCRIBE: "auto_subscribe",
} as const;

export const SUBSCRIPTION_TYPES = {
  CHANNEL: "channel",
  PLAYLIST: "playlist",
  WATCH_LATER: "watch_later",
  LIKED: "liked",
} as const;

export const MAX_SUBSCRIPTIONS_PER_USER = 20;

export const MAX_API_KEYS_PER_USER = 5;

/** iCloud install link for the "Add to Cliphy" Apple Shortcut. Empty until published. */
export const SHORTCUT_INSTALL_URL = "";

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
  CLIPS: {
    ADD: "/api/clips",
  },
  SUMMARIES: {
    LIST: "/api/summaries",
    ITEM: (id: string) => `/api/summaries/${id}`,
    TAGS: (id: string) => `/api/summaries/${id}/tags`,
    NOTES: (id: string) => `/api/summaries/${id}/notes`,
    SEARCH: "/api/summaries/search",
    AUTO_TAG: (id: string) => `/api/summaries/${id}/auto-tag`,
    AUTO_TAG_BULK: "/api/summaries/auto-tag/bulk",
    CHAT: (id: string) => `/api/summaries/${id}/chat`,
    UPDATE: (id: string) => `/api/summaries/${id}`,
    TRANSLATE: (id: string) => `/api/summaries/${id}/translate`,
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
  SUBSCRIPTIONS: {
    LIST: "/api/subscriptions",
    ADD: "/api/subscriptions",
    ITEM: (id: string) => `/api/subscriptions/${id}`,
  },
  AUTH_GOOGLE: {
    CONNECT: "/api/auth/google",
    CALLBACK: "/api/auth/google/callback",
    DISCONNECT: "/api/auth/google",
    STATUS: "/api/auth/google/status",
  },
  KEYS: {
    LIST: "/api/keys",
    CREATE: "/api/keys",
    ITEM: (id: string) => `/api/keys/${id}`,
  },
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
