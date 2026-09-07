import { API_ROUTES } from "@cliphy/shared";
import type {
  PinnedItem,
  ViewQuery,
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  TagsResponse,
  UsageResponse,
  Summary,
  ProRequiredResponse,
  AutoTagSuggestion,
  BulkAutoTagResponse,
  ChatMessage,
  ChatResponse,
  SummaryJson,
  UserSettings,
  SummaryLanguageCode,
} from "@cliphy/shared";
import { getAccessToken, isTokenExpired, refreshAccessToken } from "./auth";
import { Sentry } from "./sentry";

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3001";

/**
 * Thrown when the server returns 401 after a refresh attempt has already been tried.
 * Indicates the session is truly expired and the user should re-authenticate.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Thrown when the server returns 429 with a RATE_LIMITED code.
 * Carries the limit and plan so UI can show a specific message.
 */
export class RateLimitError extends Error {
  readonly code = "rate_limited" as const;
  readonly limit: number;
  readonly plan: string;

  constructor(body: { error: string; limit: number; plan: string }) {
    super(body.error);
    this.name = "RateLimitError";
    this.limit = body.limit;
    this.plan = body.plan;
  }
}

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

/**
 * Thrown when a free user exceeds their unique tag limit.
 */
export class TagLimitError extends Error {
  readonly code = "TAG_LIMIT" as const;
  readonly limit: number;
  readonly plan: string;

  constructor(body: { error: string; limit: number; plan: string }) {
    super(body.error);
    this.name = "TagLimitError";
    this.limit = body.limit;
    this.plan = body.plan;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let token = await getAccessToken();

  // Proactively refresh if token is expired or about to expire
  if (token && isTokenExpired(token)) {
    token = await refreshAccessToken();
  }

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

  let res: Response;
  try {
    res = await doFetch(token);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("You're offline. Check your connection and try again.", { cause: err });
    }
    Sentry.captureException(err);
    throw err;
  }

  // If 401 despite proactive check, try refreshing once more
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // 401 after refresh attempt — session is truly expired
    if (res.status === 401) {
      throw new AuthError(body.error || "Session expired");
    }

    // 402: Pro feature required — throw specialized error
    if (res.status === 402 && body.code === "pro_required") {
      throw new ProRequiredError(body as ProRequiredResponse);
    }

    // 403: Tag limit reached — throw specialized error
    if (res.status === 403 && body.code === "TAG_LIMIT") {
      throw new TagLimitError(body as { error: string; limit: number; plan: string });
    }

    // 429: Rate limited — throw specialized error
    if (res.status === 429 && body.code === "RATE_LIMITED") {
      throw new RateLimitError(body as { error: string; limit: number; plan: string });
    }

    // Report 5xx and other unexpected status codes to Sentry
    if (res.status >= 500) {
      Sentry.captureException(new Error(body.error || `Request failed: ${res.status}`), {
        extra: { status: res.status, path },
      });
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

export async function getSummaries(tag?: string) {
  const url = tag
    ? `${API_ROUTES.SUMMARIES.LIST}?tag=${encodeURIComponent(tag)}`
    : API_ROUTES.SUMMARIES.LIST;
  return request<{ summaries: Summary[] }>(url);
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

export async function updateSummaryTags(id: string, tags: string[]) {
  return request<TagsResponse>(API_ROUTES.SUMMARIES.TAGS(id), {
    method: "PATCH",
    body: JSON.stringify({ tags }),
  });
}

export async function getAllTags() {
  return request<TagsResponse>(API_ROUTES.TAGS.LIST);
}

export async function autoTagSummary(summaryId: string): Promise<AutoTagSuggestion> {
  return request<AutoTagSuggestion>(API_ROUTES.SUMMARIES.AUTO_TAG(summaryId), {
    method: "POST",
  });
}

export async function autoTagBulk(summaryIds: string[]): Promise<BulkAutoTagResponse> {
  return request<BulkAutoTagResponse>(API_ROUTES.SUMMARIES.AUTO_TAG_BULK, {
    method: "POST",
    body: JSON.stringify({ summaryIds }),
  });
}

export async function createCheckout() {
  return request<{ url: string }>(API_ROUTES.BILLING.CHECKOUT, {
    method: "POST",
  });
}

export async function createPortal() {
  return request<{ url: string }>(API_ROUTES.BILLING.PORTAL, {
    method: "POST",
  });
}

export async function getChatHistory(id: string) {
  return request<{ messages: ChatMessage[] }>(API_ROUTES.SUMMARIES.CHAT(id), {
    method: "GET",
  });
}

export async function chatWithSummary(id: string, messages: ChatMessage[]) {
  return request<ChatResponse>(API_ROUTES.SUMMARIES.CHAT(id), {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function updateSummaryJson(id: string, summaryJson: SummaryJson) {
  return request<{ summary: Summary }>(API_ROUTES.SUMMARIES.UPDATE(id), {
    method: "PATCH",
    body: JSON.stringify({ summary_json: summaryJson }),
  });
}

export async function getSettings() {
  return request<UserSettings>(API_ROUTES.SETTINGS);
}

export async function updateSettings(settings: Partial<UserSettings>) {
  return request<UserSettings>(API_ROUTES.SETTINGS, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export async function translateSummary(
  id: string,
  language: SummaryLanguageCode,
): Promise<{ summaryJson: SummaryJson; cached: boolean }> {
  return request<{ summaryJson: SummaryJson; cached: boolean }>(
    API_ROUTES.SUMMARIES.TRANSLATE(id),
    {
      method: "POST",
      body: JSON.stringify({ language }),
    },
  );
}

// ── New tab: pins, panels, bookmarks, archive ────────────────

export async function getPins() {
  return request<{ pins: PinnedItem[] }>(API_ROUTES.PINS.LIST);
}

export async function createPin(body: {
  kind: "clip" | "view";
  layout?: "tile" | "panel";
  label?: string;
  iconUrl?: string;
  clipId?: string;
  viewQuery?: ViewQuery;
  position?: number;
}) {
  return request<{ pin: PinnedItem }>(API_ROUTES.PINS.CREATE, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deletePin(id: string) {
  return request<{ ok: true }>(API_ROUTES.PINS.ITEM(id), { method: "DELETE" });
}

export async function reorderPins(ids: string[]) {
  return request<{ ok: true }>(API_ROUTES.PINS.REORDER, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function getPinItems(id: string) {
  return request<{ clips: Summary[] }>(API_ROUTES.PINS.ITEMS(id));
}

export async function archiveClip(id: string) {
  return request<{ id: string; archivedAt: string }>(API_ROUTES.SUMMARIES.ARCHIVE(id), {
    method: "POST",
  });
}

export async function unarchiveClip(id: string) {
  return request<{ id: string; archivedAt: null }>(API_ROUTES.SUMMARIES.UNARCHIVE(id), {
    method: "POST",
  });
}

/** Today's date in the user's own timezone, as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getTodayNote(date: string) {
  return request<{ note: Summary | null }>(API_ROUTES.NOTES.TODAY(date));
}

export async function appendNote(text: string, date: string) {
  return request<{ note: Summary }>(API_ROUTES.NOTES.APPEND, {
    method: "POST",
    body: JSON.stringify({ text, date }),
  });
}

export async function updateNote(id: string, content: string) {
  return request<{ note: Summary }>(API_ROUTES.NOTES.ITEM(id), {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

/**
 * Stow an open tab into the inbox. No pin is created — stowing files something
 * away to deal with later, which is the inbox; tiles are for things you return
 * to. `summarize` picks the enrichment tier: metadata is instant and makes no
 * Claude call, full runs the normal pipeline and counts against usage limits.
 */
export async function stowTab(url: string, summarize: boolean) {
  return request<{ clip: Summary }>(API_ROUTES.CLIPS.ADD, {
    method: "POST",
    body: JSON.stringify({ url, tier: summarize ? "full" : "metadata" }),
  });
}

/**
 * Add a site as a bookmark tile: a metadata-tier clip (no Claude pass, but
 * still embedded so it stays searchable) plus a tile pin pointing at it.
 */
export async function addBookmark(url: string, label?: string) {
  const { clip } = await request<{ clip: Summary }>(API_ROUTES.CLIPS.ADD, {
    method: "POST",
    body: JSON.stringify({ url, tier: "metadata" }),
  });
  const { pin } = await createPin({
    kind: "clip",
    layout: "tile",
    clipId: clip.id,
    label: label ?? clip.videoTitle,
  });
  return { clip, pin };
}
