export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type PlanTier = "free" | "pro";

export interface User {
  id: string;
  email: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  status: SummaryStatus;
  createdAt: string;
}

export interface Summary {
  id: string;
  queueItemId: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  content: string;
  keyPoints: string[];
  createdAt: string;
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
}

export interface QueueAddResponse {
  item: QueueItem;
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
