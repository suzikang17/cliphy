import { API_ROUTES } from "@cliphy/shared";
import type {
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  UsageResponse,
  Summary,
  ChatMessage,
  ChatResponse,
} from "@cliphy/shared";
import { supabase } from "./supabase";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ProRequiredError extends Error {
  readonly code = "pro_required" as const;
  readonly feature: string;
  readonly upgradeUrl: string;

  constructor(body: { error: string; feature: string; upgrade_url: string }) {
    super(body.error);
    this.name = "ProRequiredError";
    this.feature = body.feature;
    this.upgradeUrl = body.upgrade_url;
  }
}

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    if (res.status === 401) {
      throw new AuthError(body.error || "Session expired");
    }
    if (res.status === 402 && body.code === "pro_required") {
      throw new ProRequiredError(body);
    }
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// Auth
export async function getUser() {
  return request<{ user: { email: string; plan: string } }>(API_ROUTES.AUTH.ME);
}

// Queue
export async function addToQueue(body: QueueAddRequest) {
  return request<QueueAddResponse>(API_ROUTES.QUEUE.ADD, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getQueue() {
  return request<{ items: Summary[] }>(API_ROUTES.QUEUE.LIST);
}

export async function deleteQueueItem(id: string) {
  return request<{ deleted: true }>(API_ROUTES.QUEUE.ITEM(id), { method: "DELETE" });
}

export async function retryQueueItem(id: string) {
  return request<{ summary: Summary }>(API_ROUTES.QUEUE.RETRY(id), { method: "POST" });
}

// Summaries
export async function getSummaries(tag?: string) {
  const url = tag
    ? `${API_ROUTES.SUMMARIES.LIST}?tag=${encodeURIComponent(tag)}`
    : API_ROUTES.SUMMARIES.LIST;
  return request<{ summaries: Summary[] }>(url);
}

export async function getSummary(id: string) {
  return request<SummaryResponse>(API_ROUTES.SUMMARIES.ITEM(id));
}

export async function deleteSummary(id: string) {
  return request<{ deleted: true }>(API_ROUTES.SUMMARIES.ITEM(id), { method: "DELETE" });
}

// Usage
export async function getUsage() {
  return request<UsageResponse>(API_ROUTES.USAGE.INFO);
}

// Billing
export async function createCheckout() {
  return request<{ url: string }>(API_ROUTES.BILLING.CHECKOUT, { method: "POST" });
}

export async function createPortal() {
  return request<{ url: string }>(API_ROUTES.BILLING.PORTAL, { method: "POST" });
}

// Chat
export async function chatWithSummary(id: string, messages: ChatMessage[]) {
  return request<ChatResponse>(API_ROUTES.SUMMARIES.CHAT(id), {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}
