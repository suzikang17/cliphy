import { API_ROUTES } from "@cliphy/shared";
import type {
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  UsageResponse,
  Summary,
} from "@cliphy/shared";
import { getAccessToken, refreshAccessToken } from "./auth";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3001";

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
  return request<{ summary: Summary }>(API_ROUTES.QUEUE.PROCESS(id), {
    method: "POST",
  });
}
