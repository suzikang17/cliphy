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

// ── Reminders (plan 2) ───────────────────────────────────────────────────

export type ReminderKind = "day_before" | "morning_of" | "at_time";
export type ReminderStatus = "scheduled" | "sent" | "delivered" | "acked" | "cancelled" | "expired";

/** A reminder as the phone needs it: when, and the words to show. */
export interface CoachReminder {
  id: string;
  taskId: string;
  kind: ReminderKind;
  fireAt: string;
  status: ReminderStatus;
  title: string;
  body: string;
}

export interface CoachSettings {
  /**
   * False until the user's device has reported a timezone. Nothing is planned
   * before then, so a reminder can never fire at the wrong hour of the night.
   */
  timezoneSet?: boolean;
  /** IANA name, e.g. "America/Los_Angeles". "UTC" stands in until one is set. */
  timezone: string;
  /** Nothing notifies from quietStart to quietEnd, local time, "HH:MM". */
  quietStart: string;
  quietEnd: string;
  /** Weekly back-burner review: day (0 = Sunday) and local time. */
  reviewDow: number;
  reviewTime: string;
  /** When she works. Null until set: with none, the bot never checks in. */
  work?: WorkHours | null;
  /** What she last said she is working on. */
  focus?: { projectId: string; setAt: string } | null;
}

export interface WorkHours {
  /** Days of the week, 0 for Sunday. */
  days: number[];
  start: string;
  end: string;
}

/** A photo of work in progress, filed under a project. */
export interface ProgressEntry {
  id: string;
  projectId: string | null;
  url: string | null;
  createdAt: string;
}

export const DEFAULT_COACH_SETTINGS: CoachSettings = {
  timezoneSet: false,
  timezone: "UTC",
  quietStart: "21:00",
  quietEnd: "08:00",
  reviewDow: 0,
  reviewTime: "18:00",
};

export interface CoachHealth {
  pushTokens: number;
  /** Reminders are only planned once this is true. */
  timezoneSet: boolean;
  pushOk: boolean;
  lastDeliveredAt: string | null;
  /** When the Mac helper that captures messages last reported in. */
  helperSeenAt: string | null;
}

// ── Chat thread (plan 3) ─────────────────────────────────────────────────

/** What tapping a button does. Executed on the server, once. */
export type ChatAction =
  | { type: "answer_request"; requestId: string; answer: string }
  | { type: "confirm_request"; requestId: string }
  | { type: "fix_request"; requestId: string }
  | { type: "task_state"; taskId: string; state: "done" | "dropped" | "open" }
  | { type: "task_sent"; taskId: string }
  | { type: "snooze"; taskId: string; days: number }
  | { type: "close_ask"; taskId: string }
  | { type: "undo_rule"; ruleId: string }
  /** "I'm on this": sets the current focus. */
  | { type: "set_focus"; projectId: string }
  /** Put a progress photo in a project (or move it to another). */
  | { type: "file_progress"; entryId: string; projectId: string }
  | { type: "open"; link: ChatLink }
  | { type: "dismiss" };

export interface ChatButton {
  label: string;
  action: ChatAction;
}

export interface ChatLink {
  type: "request" | "task" | "project" | "upnext" | "setup" | "camera";
  id?: string;
}

/** Why the bot spoke. With `refId`, also what stops it saying the same thing twice. */
export type ChatKind =
  | "request"
  | "reply"
  | "reminder"
  | "unblocked"
  | "review"
  | "health"
  | "rule"
  | "did"
  | "answer"
  | "checkin"
  | "progress"
  | "user";

export interface CoachChatMessage {
  id: string;
  role: "bot" | "user";
  text: string;
  attachments: Attachment[];
  buttons: ChatButton[];
  link: ChatLink | null;
  /** Index of the button the user tapped, once they have. */
  chosen: number | null;
  kind: ChatKind;
  createdAt: string;
}

export interface CoachRule {
  id: string;
  sentence: string;
  personId: string | null;
  projectId: string | null;
  active: boolean;
  createdAt: string;
}

export const MAX_CHAT_BUTTONS = 3;

// ── Up next (plan 3) ─────────────────────────────────────────────────────

export interface UpNextTask {
  id: string;
  kind: TaskKind;
  title: string;
  /** One short detail: who asked and for when, or the time. */
  detail: string;
  dueDate: string | null;
  blocked: boolean;
}

export interface UpNext {
  /** The strip at the top of Chat. */
  strip: { thisWeek: number; next: string | null };
  overdue: UpNextTask[];
  thisWeek: { date: string; tasks: UpNextTask[] }[];
  later: UpNextTask[];
  /** The ball is with someone else. */
  waiting: UpNextTask[];
  errands: { place: string; tasks: UpNextTask[] }[];
  backBurner: { count: number; titles: string[] };
  byProject: {
    projectId: string;
    name: string;
    state: string;
    next: string | null;
    open: number;
  }[];
}
