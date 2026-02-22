export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type PlanTier = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  dailySummaryCount: number;
  dailyCountResetAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Shape of the AI-generated summary stored as JSONB in summaries.summary_json */
export interface SummaryJson {
  summary: string;
  keyPoints: string[];
  timestamps: string[];
}

/** Unified queue + result row from the `summaries` table */
export interface Summary {
  id: string;
  userId: string;
  videoId: string;
  videoTitle?: string;
  videoUrl?: string;
  status: SummaryStatus;
  summaryJson?: SummaryJson;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageInfo {
  used: number;
  limit: number;
  plan: PlanTier;
  resetAt: string;
}

// API request/response types

export interface QueueAddRequest {
  videoUrl: string;
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
