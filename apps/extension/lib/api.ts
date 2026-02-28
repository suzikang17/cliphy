import { API_ROUTES } from "@cliphy/shared";
import type {
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  UsageResponse,
  Summary,
  ProRequiredResponse,
} from "@cliphy/shared";
import { getAccessToken, refreshAccessToken } from "./auth";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3001";

/**
 * Custom error for 402 Pro Required responses.
 * Carries the upgrade URL and feature name so UI can show contextual prompts.
 */
export class ProRequiredError extends Error {
  readonly code = "pro_required" as const;
  readonly feature: string;
  readonly upgradeUrl: string;

  constructor(body: ProRequiredResponse) {
    super(body.error);
    this.name = "ProRequiredError";
    this.feature = body.feature;
    this.upgradeUrl = body.upgrade_url;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();

  const doFetch = async (authToken: string | null) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...options?.headers,
      },
    });
    return res;
  };

  let res = await doFetch(token);

  // If 401, try refreshing the token once
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // 402: Pro feature required — throw specialized error
    if (res.status === 402 && body.code === "pro_required") {
      throw new ProRequiredError(body as ProRequiredResponse);
    }

    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export async function getUser() {
  return request<{ user: { email: string; plan: string } }>(API_ROUTES.AUTH.ME);
}

export async function addToQueue(body: QueueAddRequest) {
  return request<QueueAddResponse>(API_ROUTES.QUEUE.ADD, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function addToQueueBatch(videos: Array<{ videoUrl: string }>) {
  return request<{ summaries: Summary[]; added: number; skipped: number }>(API_ROUTES.QUEUE.BATCH, {
    method: "POST",
    body: JSON.stringify({ videos }),
  });
}

export async function getQueue() {
  return request<{ items: Summary[] }>(API_ROUTES.QUEUE.LIST);
}

export async function getSummary(id: string) {
  return request<SummaryResponse>(API_ROUTES.SUMMARIES.ITEM(id));
}

export async function getSummaries() {
  return request<{ summaries: Summary[] }>(API_ROUTES.SUMMARIES.LIST);
}

export async function getUsage() {
  return request<UsageResponse>(API_ROUTES.USAGE.INFO);
}

export async function deleteSummary(id: string) {
  return request<{ deleted: true }>(API_ROUTES.SUMMARIES.ITEM(id), {
    method: "DELETE",
  });
}

export async function deleteQueueItem(id: string) {
  return request<{ deleted: true }>(API_ROUTES.QUEUE.ITEM(id), {
    method: "DELETE",
  });
}

export async function retryQueueItem(id: string) {
  return request<{ summary: Summary }>(API_ROUTES.QUEUE.RETRY(id), {
    method: "POST",
  });
}
