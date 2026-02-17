import { API_ROUTES } from "@cliphy/shared";
import type {
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  UsageResponse,
  Summary,
} from "@cliphy/shared";
import { getAuthToken } from "./auth";

const API_URL = "http://localhost:3000"; // TODO: configurable via env/storage

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
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
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function addToQueue(body: QueueAddRequest) {
  return request<QueueAddResponse>(API_ROUTES.QUEUE.ADD, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getQueue() {
  return request<{ summaries: Summary[] }>(API_ROUTES.QUEUE.LIST);
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
