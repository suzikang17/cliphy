// Creative coach (build 1a): types shared by the server and the phone app.

export type PersonRole = "client" | "collaborator" | "both";
export type HistoryWindow = "new" | "window" | "all";
export type Channel = "imessage" | "sms" | "share";
export type Direction = "in" | "out";
export type BundleStatus = "collecting" | "processing" | "done" | "failed";
export type BundleKind = "request" | "reply" | "chat";
export type RequestStatus = "new" | "confirmed" | "replaced" | "closed";
export type TaskKind = "do" | "tell" | "ask" | "get";
export type TaskState = "open" | "waiting" | "done" | "dropped";

export const PERSON_ROLES: readonly PersonRole[] = ["client", "collaborator", "both"];
export const HISTORY_WINDOWS: readonly HistoryWindow[] = ["new", "window", "all"];
export const CHANNELS: readonly Channel[] = ["imessage", "sms", "share"];
export const BUNDLE_KINDS: readonly BundleKind[] = ["request", "reply", "chat"];
export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "new",
  "confirmed",
  "replaced",
  "closed",
];
export const TASK_KINDS: readonly TaskKind[] = ["do", "tell", "ask", "get"];
export const TASK_STATES: readonly TaskState[] = ["open", "waiting", "done", "dropped"];

/** Messages from one person within this long of each other are one bundle. */
export const BUNDLE_QUIET_MS = 180_000;
export const MAX_QUESTION_OPTIONS = 3;

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  handles: string[];
  captureThread: boolean;
  historyWindow: HistoryWindow;
  historyDays: number | null;
}

export interface Project {
  id: string;
  name: string;
  tag: string;
  active: boolean;
  stateLine: string;
  personIds: string[];
}

export interface Attachment {
  storagePath: string;
  mediaType: string;
  url?: string;
  clipId?: string;
}

export interface InboundMessage {
  id: string;
  personId: string;
  channel: Channel;
  direction: Direction;
  text: string;
  attachments: Attachment[];
  sentAt: string;
}

export interface OpenQuestion {
  text: string;
  options: string[];
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskKit {
  materials?: string[];
  target?: string;
  doneWhen?: string;
  draft?: string;
}

export interface ProposedTask {
  kind: TaskKind;
  title: string;
  withPerson: boolean;
  /** Index of the proposed task this one waits for, or null. */
  after: number | null;
  /** True for the `ask` that exists only to settle the request's open question. */
  answersQuestion: boolean;
  kit: TaskKit;
}

export interface CoachRequest {
  id: string;
  bundleId: string;
  projectId: string | null;
  personId: string;
  understood: string;
  openQuestion: OpenQuestion | null;
  answer: string | null;
  status: RequestStatus;
  replacesId: string | null;
  proposedReplacesId: string | null;
  proposedTasks: ProposedTask[];
  dueDate: string | null;
  historical: boolean;
  createdAt: string;
  confirmedAt: string | null;
}

export interface CoachTask {
  id: string;
  requestId: string | null;
  projectId: string | null;
  kind: TaskKind;
  state: TaskState;
  title: string;
  kit: TaskKit;
  withPersonId: string | null;
  afterTaskId: string | null;
  blocked: boolean;
  dueDate: string | null;
  dueTime: string | null;
  place: string | null;
  checklist: ChecklistItem[];
  replyBundleId: string | null;
  createdAt: string;
  doneAt: string | null;
}
