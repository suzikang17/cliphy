import type {
  BatchCandidates,
  BatchItem,
  BatchItemState,
  CoachBatch,
  CoachChatMessage,
  CoachHealth,
  CoachReminder,
  CoachRequest,
  CoachRule,
  CoachRun,
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
/** "Still needs doing": a request filed as history is read again as a new one. */
export const reopenRequest = (id: string) =>
  apiFetch<{ ok: true }>(`/api/coach/requests/${id}/reopen`, json("POST", {}));

// Tasks
export const getTasks = () => apiFetch<{ tasks: CoachTask[] }>("/api/coach/tasks");
export const createTask = (body: {
  kind: TaskKind;
  title: string;
  projectId?: string;
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
export const createProject = (name: string) =>
  apiFetch<{ project: Project }>("/api/coach/projects", json("POST", { name }));
export const updateProject = (id: string, body: { repo?: string; siteUrl?: string }) =>
  apiFetch<{ project: Project }>(`/api/coach/projects/${id}`, json("PATCH", body));
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
/** Connect the Mac helper that is showing this code to the signed-in account. */
export const claimPairCode = (code: string) =>
  apiFetch<{ paired: true }>("/api/coach/pair/claim", json("POST", { code }));

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

// The website task runner
/** The newest run for a task, or null when it has never been run. */
export const getRun = (taskId: string) =>
  apiFetch<{ run: CoachRun | null }>(`/api/coach/runs?taskId=${encodeURIComponent(taskId)}`);
export const startRun = (taskId: string) =>
  apiFetch<{ run: CoachRun }>("/api/coach/runs", json("POST", { taskId }));
export const cancelRun = (runId: string) =>
  apiFetch<{ run: CoachRun }>(`/api/coach/runs/${runId}/cancel`, json("POST"));
/** A key that can only do the runner's calls. The key itself is shown once. */
export const createRunnerKey = () =>
  apiFetch<{ key: string }>("/api/keys", json("POST", { name: "Runner", scope: "runner" }));

// Messages pulled into a task
export const getPersonMessages = (personId: string) =>
  apiFetch<{ messages: InboundMessage[] }>(`/api/coach/people/${personId}/messages`);
export const getTaskMessages = (taskId: string) =>
  apiFetch<{ messages: InboundMessage[] }>(`/api/coach/tasks/${taskId}/messages`);
export const addTaskMessages = (taskId: string, messageIds: string[]) =>
  apiFetch<{ ok: true }>(`/api/coach/tasks/${taskId}/messages`, json("POST", { messageIds }));
export const removeTaskMessage = (taskId: string, messageId: string) =>
  apiFetch<{ ok: true }>(`/api/coach/tasks/${taskId}/messages/${messageId}`, json("DELETE"));

// Batches: finished work, checked, then summarized for the client
export const getBatches = (projectId: string) =>
  apiFetch<{ batches: CoachBatch[] }>(
    `/api/coach/batches?projectId=${encodeURIComponent(projectId)}`,
  );
export const getBatchCandidates = (personId: string, projectId?: string) =>
  apiFetch<BatchCandidates>(
    `/api/coach/batches/candidates?personId=${encodeURIComponent(personId)}${
      projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""
    }`,
  );
export const createBatch = (body: {
  personId: string;
  projectId?: string;
  requestIds: string[];
  messageIds: string[];
  taskIds: string[];
}) => apiFetch<{ batch: CoachBatch }>("/api/coach/batches", json("POST", body));
export const getBatch = (id: string) =>
  apiFetch<{ batch: CoachBatch; items: BatchItem[] }>(`/api/coach/batches/${id}`);
export const updateBatchItem = (
  batchId: string,
  itemId: string,
  body: { state?: BatchItemState; note?: string | null },
) =>
  apiFetch<{ item: BatchItem }>(
    `/api/coach/batches/${batchId}/items/${itemId}`,
    json("PATCH", body),
  );
export const writeBatchSummary = (id: string) =>
  apiFetch<{ batch: CoachBatch }>(`/api/coach/batches/${id}/summary`, json("POST"));
export const saveBatchSummary = (id: string, summary: string) =>
  apiFetch<{ batch: CoachBatch }>(`/api/coach/batches/${id}`, json("PATCH", { summary }));
export const markBatchSent = (id: string) =>
  apiFetch<{ batch: CoachBatch }>(`/api/coach/batches/${id}/sent`, json("POST"));
export const deleteBatch = (id: string) =>
  apiFetch<{ ok: true }>(`/api/coach/batches/${id}`, json("DELETE"));
