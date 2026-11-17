import type {
  CoachBatch,
  CoachChatMessage,
  CoachHealth,
  CoachReminder,
  CoachRun,
  CoachTask,
  InboundMessage,
  Person,
  Project,
  UpNext,
} from "@cliphy/shared";

// Everything the coach screens decide, kept out of the screens so it can be
// tested without a device.

/** Prefix of a message shown before the server has stored it. */
export const LOCAL_PREFIX = "local-";

/**
 * How long after its time a reminder's local copy fires.
 *
 * The copy is the backup for a phone with no signal. When the push did arrive
 * the app cancels the copy as soon as it runs, but a locked phone runs no app
 * code, so the copy must wait long enough that it only shows when the
 * reminder really has gone unanswered for a while.
 */
export const MIRROR_DELAY_MS = 15 * 60_000;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Fold freshly polled messages into the thread.
 * - Same id: the server's copy wins, except that a tap already shown is never
 *   cleared by a poll that started before the tap landed.
 * - A message typed here and not yet confirmed is kept until the server
 *   returns it, then replaced by the server's copy.
 */
export function mergeMessages(
  have: CoachChatMessage[],
  got: CoachChatMessage[],
): CoachChatMessage[] {
  const byId = new Map<string, CoachChatMessage>();
  for (const m of have) byId.set(m.id, m);

  for (const m of got) {
    const mine = byId.get(m.id);
    byId.set(
      m.id,
      mine && mine.chosen !== null && m.chosen === null ? { ...m, chosen: mine.chosen } : m,
    );
    if (m.role === "user") {
      for (const [id, local] of byId) {
        if (id.startsWith(LOCAL_PREFIX) && local.role === "user" && local.text === m.text) {
          byId.delete(id);
          break;
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The newest server-stored time in the thread, to ask the server for anything after it. */
export function newestTime(messages: CoachChatMessage[]): string | undefined {
  let newest: string | undefined;
  for (const m of messages) {
    if (m.id.startsWith(LOCAL_PREFIX)) continue;
    if (!newest || m.createdAt > newest) newest = m.createdAt;
  }
  return newest;
}

/** The server's way of saying this account does not have the coach. */
export function isCoachOff(err: unknown): boolean {
  return err instanceof Error && err.message === "coach_not_enabled";
}

/**
 * A link that opens Messages with `body` ready to send to `handle`, or null
 * when the handle is not a phone number (the draft is then copied instead).
 */
export function smsUrl(
  handle: string | null | undefined,
  body: string,
  platform: "ios" | "android",
): string | null {
  if (!handle || handle.includes("@")) return null;
  const number = handle.replace(/[^\d+]/g, "");
  if (number.replace(/\D/g, "").length < 3) return null;
  // iOS and Android disagree on how the body is attached.
  return `sms:${number}${platform === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

export interface LocalReminder {
  identifier: string;
  reminderId: string;
  taskId: string;
  title: string;
  body: string;
  date: Date;
}

/**
 * The identifier of a reminder's local copy. It includes the time, so a
 * reminder whose time changes gets a new copy and the old one is cancelled.
 */
export const mirrorId = (r: { id: string; fireAt: string }): string =>
  `coach-${r.id}-${Date.parse(r.fireAt)}`;

/** Every scheduled local copy of one reminder, whatever time it was scheduled for. */
export const mirrorIdsFor = (reminderId: string, scheduled: string[]): string[] =>
  scheduled.filter((id) => id.startsWith(`coach-${reminderId}-`));

/**
 * Which local notifications to add and remove so the phone holds a backup of
 * every upcoming reminder and nothing stale. `scheduled` is the identifiers
 * currently scheduled on the device (other apps' or features' are ignored).
 */
export function mirrorPlan(
  reminders: CoachReminder[],
  scheduled: string[],
  now: Date,
): { schedule: LocalReminder[]; cancel: string[] } {
  const wanted = new Map<string, LocalReminder>();
  for (const r of reminders) {
    const date = new Date(Date.parse(r.fireAt) + MIRROR_DELAY_MS);
    if (date.getTime() <= now.getTime()) continue;
    const identifier = mirrorId(r);
    wanted.set(identifier, {
      identifier,
      reminderId: r.id,
      taskId: r.taskId,
      title: r.title,
      body: r.body,
      date,
    });
  }
  const have = new Set(scheduled);
  return {
    schedule: [...wanted.values()].filter((w) => !have.has(w.identifier)),
    cancel: scheduled.filter((id) => id.startsWith("coach-") && !wanted.has(id)),
  };
}

export type SetupStep = "reminders" | "person" | "messages" | "try";

/**
 * The first-run steps still to do, in order. Reminders count as working only
 * once one has actually been delivered to this phone, not merely allowed.
 */
export function setupSteps(health: CoachHealth, people: Person[], tried: boolean): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!(health.pushTokens > 0 && health.pushOk && health.lastDeliveredAt)) steps.push("reminders");
  if (people.length === 0) steps.push("person");
  if (!people.some((p) => p.captureThread)) steps.push("messages");
  if (!tried) steps.push("try");
  return steps;
}

/** "2026-11-14" → { num: "14", dow: "Sat" } for a list row. */
export function dayParts(date: string): { num: string; dow: string } {
  const [y, m, d] = date.split("-").map(Number);
  return { num: String(d), dow: DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

// ── Remembering the thread between launches ──────────────────────────────

const STORED_MESSAGES = 50;

export interface StoredCoach {
  status: "on" | "off";
  messages: CoachChatMessage[];
}

/**
 * What to keep on the phone so a launch with no network still shows Chat and
 * the last of the thread. Messages typed but never sent are not kept.
 */
export function toStored(state: { status: string; messages: CoachChatMessage[] }): string {
  return JSON.stringify({
    status: state.status,
    messages: state.messages.filter((m) => !m.id.startsWith(LOCAL_PREFIX)).slice(-STORED_MESSAGES),
  });
}

/** Read back what `toStored` wrote, or null for anything missing or unreadable. */
export function fromStored(raw: string | null | undefined): StoredCoach | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; messages?: unknown };
    if (parsed.status !== "on" && parsed.status !== "off") return null;
    if (!Array.isArray(parsed.messages)) return null;
    return { status: parsed.status, messages: parsed.messages as CoachChatMessage[] };
  } catch {
    return null;
  }
}

// ── When something was last seen ─────────────────────────────────────────

/** "2 min ago", "3 h ago", "3 days ago"; null when it has never been seen. */
export function agoLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The Mac helper reports in every 20 seconds; 90 silent seconds means it is not running. */
export function helperRunning(seenAt: string | null | undefined, now: Date): boolean {
  return Boolean(seenAt) && now.getTime() - Date.parse(seenAt as string) < 90_000;
}

/** The Mac helper's pairing code as it is typed: upper case, grouped 4-4. */
export function formatPairCode(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

export const pairCodeComplete = (code: string): boolean => formatPairCode(code).length === 9;

/** How long to wait for a reopened history request to come back as a new one. */
export const REOPEN_WAIT_MS = 60_000;

/**
 * After "Still needs doing": has the request come back as a new one? After a
 * minute the page stops watching. That is not a verdict: a slow re-read still
 * arrives in Chat, and one that finds nothing to do never does.
 */
export function reopenOutcome(
  now: { historical: boolean; status: string } | null,
  waitedMs: number,
): "waiting" | "reopened" | "still-reading" {
  if (now && !now.historical && now.status === "new") return "reopened";
  return waitedMs >= REOPEN_WAIT_MS ? "still-reading" : "waiting";
}

// ── The website task runner ──────────────────────────────────────────────

/**
 * A message's text split into plain parts and https links, so the links can be
 * tapped. Punctuation that ends the sentence around a link is not part of it.
 */
export function textParts(text: string): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(/https:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    const start = match.index;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: url, url });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Where a run has got to, in one line. Null when the task has never been run. */
export function runLine(run: CoachRun | null): string | null {
  if (!run) return null;
  switch (run.status) {
    case "queued":
      return "Waiting for the runner.";
    case "working":
      return run.note ? `Working: ${run.note}` : "Working on it.";
    case "done":
      return "Done. See Chat for the result.";
    case "failed":
      return run.error ? `That didn't work: ${run.error}` : "That didn't work.";
    case "cancelled":
      return "Stopped.";
  }
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A day as "17 Nov". */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** Where a batch has got to, in one line. */
export function batchLine(batch: CoachBatch): string {
  if (batch.status === "sent") return batch.sentAt ? `Sent ${shortDay(batch.sentAt)}` : "Sent";
  if (batch.uncheckedCount > 0) return `${batch.uncheckedCount} of ${batch.itemCount} to check`;
  return batch.status === "ready" ? "Ready to send" : "Checked. Write the summary.";
}

/** A message in one line: its words, or "Photo" when it is only pictures. */
export function messageLine(message: InboundMessage): string {
  return message.text.trim() || (message.attachments.length > 0 ? "Photo" : "");
}

export interface ProjectRow {
  id: string;
  name: string;
  /** The client, then the next thing to do or where the project stands. */
  detail: string | undefined;
  open: number;
  active: boolean;
}

/** The Projects list: ones with open work first, then by name, inactive ones last. */
export function projectRows(
  projects: Project[],
  byProject: UpNext["byProject"],
  people: Pick<Person, "id" | "name">[],
): ProjectRow[] {
  const work = new Map(byProject.map((p) => [p.projectId, p]));
  const names = new Map(people.map((p) => [p.id, p.name]));
  const rank = (r: ProjectRow) => (!r.active ? 2 : r.open > 0 ? 0 : 1);

  return projects
    .map((project) => {
      const found = work.get(project.id);
      const client = project.personIds.map((id) => names.get(id)).find(Boolean);
      const parts = [client, found?.next || project.stateLine || found?.state].filter(Boolean);
      return {
        id: project.id,
        name: project.name,
        detail: parts.length > 0 ? parts.join(" · ") : undefined,
        open: found?.open ?? 0,
        active: project.active,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export type DesktopSection = "chat" | "projects" | "upnext";

/** Which item of the Mac window's side nav the current screen belongs to. */
export function desktopSection(pathname: string): DesktopSection | null {
  if (pathname === "/chat") return "chat";
  if (pathname === "/coach/upnext") return "upnext";
  if (
    pathname === "/projects" ||
    pathname.startsWith("/coach/project/") ||
    pathname.startsWith("/coach/batch/")
  ) {
    return "projects";
  }
  return null;
}

/** The line to paste into a terminal so Claude Code can read and add work in Cliphy. */
export function mcpCommand(key: string, apiUrl: string): string {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/mcp`;
  return `claude mcp add --transport http --scope user cliphy ${url} --header "Authorization: Bearer ${key}"`;
}

/**
 * What the web build does when a screen opens: send the visitor to sign in,
 * start them at Chat, or leave them on the screen they asked for.
 */
export function desktopEntry(opts: {
  signedIn: boolean;
  /** True at an address with no coach screen behind it: the root, sign-in, the Library. */
  starting: boolean;
}): "sign-in" | "chat" | "stay" {
  if (!opts.signedIn) return "sign-in";
  return opts.starting ? "chat" : "stay";
}

export interface ProjectTile {
  key: "todo" | "waiting" | "ready" | "heard";
  value: string;
  label: string;
}

/** The small numbers at the top of a project: where it stands at a glance. */
export function projectTiles(opts: {
  tasks: Pick<CoachTask, "state" | "blocked">[];
  /** Finished things not yet reported to the client in a batch. */
  ready: number;
  /** When the client last wrote. */
  lastHeardAt: string | null;
  now: Date;
}): ProjectTile[] {
  const todo = opts.tasks.filter((t) => t.state === "open" && !t.blocked).length;
  const waiting = opts.tasks.filter((t) => t.state === "waiting").length;
  return [
    { key: "todo", value: String(todo), label: "To do" },
    { key: "waiting", value: String(waiting), label: "Waiting on them" },
    { key: "ready", value: String(opts.ready), label: "Ready to report" },
    { key: "heard", value: agoLabel(opts.lastHeardAt, opts.now) ?? "–", label: "Last heard" },
  ];
}

/** When a task is due, as one word or a short date. `today` is YYYY-MM-DD, local. */
export function taskDue(
  dueDate: string | null,
  today: string,
): { text: string; late: boolean } | null {
  if (!dueDate) return null;
  if (dueDate < today) return { text: "Late", late: true };
  if (dueDate === today) return { text: "Today", late: false };
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (dueDate === next.toISOString().slice(0, 10)) return { text: "Tomorrow", late: false };
  return { text: shortDay(`${dueDate}T12:00:00`), late: false };
}
