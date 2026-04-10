import { getAccessToken } from "./auth";
import { supabase } from "./supabase";
import type { Summary, UsageInfo } from "@cliphy/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL!;

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
