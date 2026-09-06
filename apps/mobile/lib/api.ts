import { getAccessToken } from "./auth";
import { supabase } from "./supabase";
import type {
  Summary,
  UsageInfo,
  Subscription,
  SubscriptionCreateRequest,
  SubscriptionUpdateRequest,
  GoogleConnectionStatus,
  CheckEmailResponse,
  ApiKey,
  ApiKeyCreateResponse,
  UserSettings,
  PodcastFeed,
  PodcastEpisode,
  PodcastFeedSettings,
} from "@cliphy/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export class AuthError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  limit: number;
  plan: string;
  constructor(limit: number, plan: string) {
    super(`Monthly limit reached (${limit})`);
    this.name = "RateLimitError";
    this.limit = limit;
    this.plan = plan;
  }
}

export class ProRequiredError extends Error {
  feature: string;
  constructor(feature: string) {
    super(`Pro required: ${feature}`);
    this.name = "ProRequiredError";
    this.feature = feature;
  }
}

export class DuplicateError extends Error {
  constructor(message = "Video already queued") {
    super(message);
    this.name = "DuplicateError";
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = await getAccessToken();

  if (!token) {
    const { data } = await supabase.auth.refreshSession();
    token = data.session?.access_token ?? null;
    if (!token) throw new AuthError();
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    const newToken = data.session?.access_token;
    if (!newToken) throw new AuthError();

    const retry = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newToken}`,
        ...options.headers,
      },
    });
    if (retry.status === 401) throw new AuthError();
    return retry.json();
  }

  if (res.status === 429) {
    const body = await res.json();
    throw new RateLimitError(body.limit, body.plan);
  }

  if (res.status === 402) {
    const body = await res.json();
    throw new ProRequiredError(body.feature);
  }

  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    if (body.code === "DUPLICATE") throw new DuplicateError(body.error);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// Queue
export const getQueue = () => apiFetch<{ items: Summary[] }>("/api/queue");

export const addToQueue = (body: { videoUrl: string; videoTitle?: string }) =>
  apiFetch<{ summary: Summary; position: number }>("/api/queue", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Universal clip ingest — accepts any URL; the server detects the source type.
export const addClip = (body: { url?: string; imagePath?: string }) =>
  apiFetch<{ clip: Summary }>("/api/clips", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getRelatedClips = (id: string) =>
  apiFetch<{ clips: Summary[] }>(`/api/clips/${id}/related`).then((d) => d.clips);

export const searchClips = (q: string) =>
  apiFetch<{ summaries: Summary[] }>(`/api/summaries/search?q=${encodeURIComponent(q)}`).then(
    (d) => d.summaries,
  );

export const deleteQueueItem = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/queue/${id}`, { method: "DELETE" });

export const retryQueueItem = (id: string) =>
  apiFetch<{ summary: Summary }>(`/api/queue/${id}/retry`, { method: "POST" });

// Summaries
export const getSummaries = (params?: { tag?: string; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return apiFetch<{ summaries: Summary[]; total: number }>(
    `/api/summaries${query ? `?${query}` : ""}`,
  );
};

export const getSummary = (id: string) => apiFetch<{ summary: Summary }>(`/api/summaries/${id}`);

export const deleteSummary = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/summaries/${id}`, { method: "DELETE" });

// Usage
export const getUsage = () => apiFetch<{ usage: UsageInfo }>("/api/usage");

// Billing
export const createCheckout = () =>
  apiFetch<{ url: string }>("/api/billing/checkout", { method: "POST" });

export const createPortal = () =>
  apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });

// Subscriptions
export const getSubscriptions = () =>
  apiFetch<{ subscriptions: Subscription[] }>("/api/subscriptions");

export const createSubscription = (body: SubscriptionCreateRequest) =>
  apiFetch<{ subscription: Subscription }>("/api/subscriptions", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateSubscription = (id: string, body: SubscriptionUpdateRequest) =>
  apiFetch<{ subscription: Subscription }>(`/api/subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteSubscription = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/subscriptions/${id}`, { method: "DELETE" });

/** Kick immediate polls of the user's subscriptions (server-throttled). */
export const refreshSubscriptions = () =>
  apiFetch<{ refreshed: number }>("/api/subscriptions/refresh", { method: "POST" });

// Settings
export const getSettings = () => apiFetch<UserSettings>("/api/settings");

export const updateSettings = (body: Partial<UserSettings>) =>
  apiFetch<UserSettings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

// API keys (for the Apple Shortcut)
export const getApiKeys = () => apiFetch<{ apiKeys: ApiKey[] }>("/api/keys");

export const createApiKey = (name?: string) =>
  apiFetch<ApiKeyCreateResponse>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const deleteApiKey = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/keys/${id}`, { method: "DELETE" });

// Google OAuth
export const getGoogleStatus = () => apiFetch<GoogleConnectionStatus>("/api/auth/google/status");

export const getGoogleConnectUrl = () =>
  apiFetch<{ url: string }>("/api/auth/google?platform=mobile");

export const disconnectGoogle = () =>
  apiFetch<{ disconnected: true }>("/api/auth/google", { method: "DELETE" });

// Podcasts
export const getPodcastFeeds = () =>
  apiFetch<{ feeds: PodcastFeed[] }>("/api/podcasts/feeds").then((d) => d.feeds);

export const createPodcastFeed = (rssUrl: string) =>
  apiFetch<{ feed: PodcastFeed }>("/api/podcasts/feeds", {
    method: "POST",
    body: JSON.stringify({ rssUrl }),
  }).then((d) => d.feed);

export const updatePodcastFeed = (id: string, settings: PodcastFeedSettings) =>
  apiFetch<{ feed: PodcastFeed }>(`/api/podcasts/feeds/${id}`, {
    method: "PATCH",
    body: JSON.stringify(settings),
  }).then((d) => d.feed);

export const deletePodcastFeed = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/podcasts/feeds/${id}`, { method: "DELETE" });

export const getPodcastEpisodes = (feedId: string, status?: string) => {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<{ episodes: PodcastEpisode[] }>(
    `/api/podcasts/feeds/${feedId}/episodes${qs}`,
  ).then((d) => d.episodes);
};

export const refreshPodcastFeed = (feedId: string) =>
  apiFetch<void>(`/api/podcasts/feeds/${feedId}/refresh`, { method: "POST" });

export const queuePodcastEpisode = (episodeId: string) =>
  apiFetch<{ episode: PodcastEpisode }>(`/api/podcasts/episodes/${episodeId}/queue`, {
    method: "POST",
  }).then((d) => d.episode);

export const skipPodcastEpisode = (episodeId: string) =>
  apiFetch<{ episode: PodcastEpisode }>(`/api/podcasts/episodes/${episodeId}/skip`, {
    method: "POST",
  }).then((d) => d.episode);

// Auth (pre-login, no token)
export async function checkEmail(email: string): Promise<CheckEmailResponse> {
  const res = await fetch(`${API_URL}/api/auth/check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) throw new Error("Too many attempts — try again in a moment.");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}
