export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type PlanTier = "free" | "pro";

export type SubscriptionStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid";

export interface User {
  id: string;
  email: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt?: string;
  monthlySummaryCount: number;
  monthlyCountResetAt: string;
  createdAt: string;
  updatedAt: string;
}

/** AI-chosen section that adapts to video content (e.g. Recipe, Steps, Action Items) */
export interface ContextSection {
  title: string;
  icon: string;
  items: string[];
}

/** Shape of the AI-generated summary stored as JSONB in summaries.summary_json */
export interface SummaryJson {
  summary: string;
  keyPoints: string[];
  /** @deprecated Use contextSection instead. Kept for backward compat with existing summaries. */
  actionItems?: string[];
  contextSection?: ContextSection;
  timestamps: string[];
  /** True if the transcript was too long and was truncated before summarization */
  truncated?: boolean;
}

/** Unified queue + result row from the `summaries` table */
export interface Summary {
  id: string;
  userId: string;
  videoId: string;
  videoTitle?: string;
  videoUrl?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
  status: SummaryStatus;
  summaryJson?: SummaryJson;
  errorMessage?: string;
  tags: string[];
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageInfo {
  used: number;
  limit: number;
  plan: PlanTier;
  resetAt: string;
  totalTimeSavedSeconds: number;
}

// API request/response types

export interface QueueAddRequest {
  videoUrl: string;
  videoTitle?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
  transcript?: string;
}

export interface QueueAddResponse {
  summary: Summary;
}

export interface SummaryResponse {
  summary: Summary;
}

export interface UsageResponse {
  usage: UsageInfo;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

export interface TagsResponse {
  tags: string[];
}

/** Returned with 402 when a free user attempts a pro-only feature. */
export interface ProRequiredResponse {
  error: string;
  code: "pro_required";
  feature: string;
  upgrade_url: string;
}
