import type {
  CoachChatMessage,
  CoachHealth,
  CoachReminder,
  CoachRequest,
  CoachRule,
  CoachSettings,
  CoachTask,
  InboundMessage,
  Person,
  PersonRole,
  ProgressEntry,
  Project,
  TaskKind,
  UpNext,
} from "@cliphy/shared";
import { apiFetch } from "./api";

// Every call the coach screens make. A 403 with "coach_not_enabled" surfaces
// as an Error with that message (see isCoachOff in ./coach).

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface HistoryEntry {
  request: CoachRequest;
  replaced: CoachRequest[];
}

// Chat
export const getChat = (after?: string) =>
  apiFetch<{ messages: CoachChatMessage[]; activity: string[] }>(
    `/api/coach/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`,
  );
export const sendChat = (text: string) =>
  apiFetch<{ messageId: string }>("/api/coach/chat", json("POST", { text }));
export const chooseButton = (messageId: string, index: number) =>
  apiFetch<{ message: CoachChatMessage; did: string | null }>(
    `/api/coach/chat/${messageId}/choose`,
    json("POST", { index }),
  );

// Up next
export const getUpNext = () => apiFetch<UpNext>("/api/coach/upnext");

// Requests
export const getRequest = (id: string) =>
  apiFetch<{ request: CoachRequest; messages: InboundMessage[]; replaces: CoachRequest | null }>(
    `/api/coach/requests/${id}`,
  );
export const confirmRequest = (id: string, body: { answer?: string; replaces?: boolean } = {}) =>
  apiFetch<{ request: CoachRequest; tasks: CoachTask[] }>(
    `/api/coach/requests/${id}/confirm`,
    json("POST", body),
  );
export const fixRequest = (id: string, note: string) =>
  apiFetch<{ ok: true }>(`/api/coach/requests/${id}/fix`, json("POST", { note }));

// Tasks
export const getTasks = () => apiFetch<{ tasks: CoachTask[] }>("/api/coach/tasks");
export const createTask = (body: {
  kind: TaskKind;
  title: string;
  dueDate?: string;
  dueTime?: string;
  place?: string;
}) => apiFetch<{ task: CoachTask }>("/api/coach/tasks", json("POST", body));
export const updateTask = (
  id: string,
  body: Partial<{
    title: string;
    state: "open" | "done" | "dropped";
    dueDate: string | null;
    dueTime: string | null;
    checklist: { text: string; done: boolean }[];
  }>,
) => apiFetch<{ task: CoachTask }>(`/api/coach/tasks/${id}`, json("PATCH", body));
export const markTaskSent = (id: string) =>
  apiFetch<{ task: CoachTask }>(`/api/coach/tasks/${id}/sent`, json("POST"));

// People and projects
export const getPeople = () => apiFetch<{ people: Person[] }>("/api/coach/people");
export const addPerson = (body: { name: string; role: PersonRole; handles?: string[] }) =>
  apiFetch<{ person: Person }>("/api/coach/people", json("POST", body));
export const updatePerson = (
  id: string,
  body: Partial<{
    handles: string[];
    captureThread: boolean;
    historyWindow: "new" | "window" | "all";
    historyDays: number;
  }>,
) => apiFetch<{ person: Person }>(`/api/coach/people/${id}`, json("PATCH", body));
export const getProjects = () => apiFetch<{ projects: Project[] }>("/api/coach/projects");
export const getProjectHistory = (id: string) =>
  apiFetch<{ entries: HistoryEntry[]; progress: ProgressEntry[] }>(
    `/api/coach/projects/${id}/history`,
  );

// Progress photos
export const addProgress = (storagePath: string, projectId?: string) =>
  apiFetch<{
    entry: ProgressEntry;
    tier: "sure" | "fairly" | "unsure";
    project: { id: string; name: string } | null;
  }>("/api/coach/progress", json("POST", { storagePath, projectId }));
export const moveProgress = (entryId: string, projectId: string) =>
  apiFetch<{ moved: boolean; say: string | null }>(
    `/api/coach/progress/${entryId}/project`,
    json("POST", { projectId }),
  );

// Reminders, settings, health
export const getReminders = () => apiFetch<{ reminders: CoachReminder[] }>("/api/coach/reminders");
export const reportDelivered = (id: string) =>
  apiFetch<{ ok: true }>(`/api/coach/reminders/${id}/delivered`, json("POST"));
export const ackReminder = (id: string) =>
  apiFetch<{ ok: true }>(`/api/coach/reminders/${id}/ack`, json("POST"));
export const getCoachSettings = () => apiFetch<{ settings: CoachSettings }>("/api/coach/settings");
export const updateCoachSettings = (body: Partial<CoachSettings>) =>
  apiFetch<{ settings: CoachSettings }>("/api/coach/settings", json("PATCH", body));
export const getHealth = () => apiFetch<CoachHealth>("/api/coach/health");
export const sendTestPush = () =>
  apiFetch<{ sent: number }>("/api/coach/health/test-push", json("POST"));

// Learned rules
export const getRules = () => apiFetch<{ rules: CoachRule[] }>("/api/coach/rules");
export const updateRule = (id: string, body: { sentence?: string; active?: boolean }) =>
  apiFetch<{ rule: CoachRule }>(`/api/coach/rules/${id}`, json("PATCH", body));
export const deleteRule = (id: string) =>
  apiFetch<{ ok: true }>(`/api/coach/rules/${id}`, json("DELETE"));

// Capture from the share sheet
export const getUploadUrl = (mediaType: string) =>
  apiFetch<{ path: string; signedUrl: string; token: string }>(
    "/api/coach/intake/upload-url",
    json("POST", { mediaType }),
  );
export const sendToChat = (body: {
  personId: string;
  messages: {
    externalId: string;
    direction: "in";
    text?: string;
    sentAt: string;
    attachments?: { storagePath: string; mediaType: string }[];
  }[];
}) =>
  apiFetch<{ stored: number; bundleIds: string[] }>(
    "/api/coach/intake/messages",
    json("POST", { ...body, channel: "share" }),
  );
