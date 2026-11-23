import { linkPath } from "./coachNav";
import type {
  Attachment,
  CoachBatch,
  CoachChatMessage,
  CoachHealth,
  CoachReminder,
  CoachRequest,
  CoachRun,
  CoachTask,
  DigestGroup,
  DigestItem,
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
      return run.error || "Error";
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

export type DesktopSection = "chat" | "projects" | "texts" | "upnext" | "library" | "settings";

/** Which item of the Mac window's side nav the current screen belongs to. */
export function desktopSection(pathname: string): DesktopSection | null {
  if (pathname === "/chat") return "chat";
  if (pathname === "/coach/upnext") return "upnext";
  if (pathname === "/coach/setup") return "settings";
  if (pathname === "/coach/library" || pathname.startsWith("/summary/")) return "library";
  if (
    pathname === "/coach/threads" ||
    pathname.startsWith("/coach/thread/") ||
    pathname.startsWith("/coach/digest/")
  ) {
    return "texts";
  }
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

// ── A person's thread: every message, and what has become of each ────────

export type ThreadFilter = "all" | "open" | "done";

/** One word for what has become of a message. The owner's own tick wins. */
export function messageMark(message: InboundMessage): "Done" | "In a batch" | "Request" | null {
  if (message.handledAt) return "Done";
  if (message.batchId) return "In a batch";
  if (message.requestId) return "Request";
  return null;
}

/** Open: something they sent that is neither ticked nor in a batch. Done: ticked or batched. */
export function threadFilter(messages: InboundMessage[], filter: ThreadFilter): InboundMessage[] {
  if (filter === "all") return messages;
  const done = (m: InboundMessage) => Boolean(m.handledAt || m.batchId);
  return messages.filter((m) => (filter === "done" ? done(m) : m.direction === "in" && !done(m)));
}

/** The thread as it reads: oldest first, under the day each message was sent. */
export function threadDays(
  messages: InboundMessage[],
): { day: string; messages: InboundMessage[] }[] {
  const days: { day: string; messages: InboundMessage[] }[] = [];
  for (const message of [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const d = new Date(message.sentAt);
    const day = `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const last = days[days.length - 1];
    if (last?.day === day) last.messages.push(message);
    else days.push({ day, messages: [message] });
  }
  return days;
}

/** Add an older page to what is already loaded, once each. */
export function mergeThread(loaded: InboundMessage[], older: InboundMessage[]): InboundMessage[] {
  const seen = new Set(loaded.map((m) => m.id));
  return [...loaded, ...older.filter((m) => !seen.has(m.id))];
}

/** How far back the Mac reads a person's texts, in a sentence. */
export function historyLine(person: Pick<Person, "historyWindow" | "historyDays">): string {
  if (person.historyWindow === "all") return "Reading everything.";
  if (person.historyWindow === "window" && person.historyDays) {
    return `Reading the last ${person.historyDays} days.`;
  }
  return "Reading new texts only.";
}

// ── Working hours ────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_END = 23 * 60 + 30;

const minutesOf = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const timeOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "17:30" as a clock shows it: "5:30 PM". */
export function timeLabel(time: string): string {
  const minutes = minutesOf(time);
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** Move a time by `by` minutes, landing on a half hour, within the day. */
export function shiftTime(time: string, by: number): string {
  const moved = Math.round((minutesOf(time) + by) / 30) * 30;
  return timeOf(Math.min(DAY_END, Math.max(0, moved)));
}

/** Move the start or the end by `by` minutes, pushing the other along so the start stays first. */
export function shiftHours(
  hours: { start: string; end: string },
  which: "start" | "end",
  by: number,
): { start: string; end: string } {
  let start = minutesOf(which === "start" ? shiftTime(hours.start, by) : hours.start);
  let end = minutesOf(which === "end" ? shiftTime(hours.end, by) : hours.end);
  if (start >= end) {
    if (which === "start") end = start + 30;
    else start = end - 30;
  }
  if (start < 0 || end > DAY_END) return hours;
  return { start: timeOf(start), end: timeOf(end) };
}

/** Working days and hours in one line: "Mon–Fri, 9:00 AM – 5:00 PM". */
export function workLine(days: number[], start: string, end: string): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const weekdays = sorted.length === 5 && sorted.every((d, i) => d === i + 1);
  // Monday first, as a working week reads.
  const names = [...sorted.filter((d) => d !== 0), ...sorted.filter((d) => d === 0)]
    .map((d) => DAY_NAMES[d])
    .join(", ");
  const when = sorted.length === 7 ? "Every day" : weekdays ? "Mon–Fri" : names;
  return `${when}, ${timeLabel(start)} – ${timeLabel(end)}`;
}

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "pictures"; pictures: Attachment[] };

/**
 * A message as it was sent: words and pictures in order. A picture with a
 * known place (`at`) goes after the words before that place; pictures with no
 * known place go at the end, as they always did.
 */
export function messageParts(text: string, attachments: Attachment[]): MessagePart[] {
  const parts: MessagePart[] = [];
  const words = (chunk: string) => {
    if (chunk.trim()) parts.push({ kind: "text", text: chunk.trim() });
  };
  const pictures = (items: Attachment[]) => {
    const last = parts[parts.length - 1];
    if (last?.kind === "pictures") last.pictures.push(...items);
    else if (items.length > 0) parts.push({ kind: "pictures", pictures: [...items] });
  };

  const placed = attachments
    .filter((a) => a.at !== undefined)
    .sort((a, b) => (a.at as number) - (b.at as number));
  let from = 0;
  for (const picture of placed) {
    const at = Math.min(text.length, Math.max(from, picture.at as number));
    words(text.slice(from, at));
    pictures([picture]);
    from = at;
  }
  words(text.slice(from));
  pictures(attachments.filter((a) => a.at === undefined));
  return parts;
}

const TITLE_LENGTH = 80;
/** A line that only says hello is not what needs doing. */
const GREETING = /^(hi|hey|hello|good (morning|afternoon|evening))\b[^?]{0,20}$/i;

/**
 * A starting title for a task made from messages: the first real line of the
 * earliest thing they wrote (mine if they wrote nothing), cut at a word.
 */
export function taskTitleFrom(messages: InboundMessage[]): string {
  const ordered = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const source =
    ordered.find((m) => m.direction === "in" && m.text.trim()) ??
    ordered.find((m) => m.text.trim());
  if (!source) return "";
  const lines = source.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((l) => !GREETING.test(l)) ?? lines[0] ?? "";
  if (line.length <= TITLE_LENGTH) return line;
  const cut = line.slice(0, TITLE_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : TITLE_LENGTH).trimEnd()}…`;
}

/**
 * What to show when something fails: the system's own message, or the one
 * word "Error". Never a sentence of our own about what might have happened.
 */
export function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Error";
}

// ── The Projects board ───────────────────────────────────────────────────

export interface ProjectCard {
  id: string;
  name: string;
  state: string | null;
  active: boolean;
  /** Tasks that can be done now. */
  todo: number;
  /** Tasks where the ball is with the client. */
  waiting: number;
  /** Up to three tasks to do next, soonest first. */
  next: { id: string; title: string; dueDate: string | null }[];
}

export interface ClientGroup {
  clientId: string | null;
  client: string | null;
  projects: ProjectCard[];
}

const NEXT_SHOWN = 3;

/**
 * Active projects grouped under their client, clients with work first and
 * the busiest project first within each. Retired projects are left out.
 */
export function projectBoard(
  projects: Project[],
  tasks: CoachTask[],
  people: Pick<Person, "id" | "name">[],
): ClientGroup[] {
  const groups = new Map<string, ClientGroup>();
  for (const project of projects.filter((p) => p.active)) {
    const mine = tasks.filter((t) => t.projectId === project.id);
    const ready = mine
      .filter((t) => t.state === "open" && !t.blocked)
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
    const client = people.find((person) => project.personIds.includes(person.id)) ?? null;
    const key = client?.id ?? "";
    const group = groups.get(key) ?? {
      clientId: client?.id ?? null,
      client: client?.name ?? null,
      projects: [],
    };
    group.projects.push({
      id: project.id,
      name: project.name,
      state: project.stateLine || null,
      active: project.active,
      todo: ready.length,
      waiting: mine.filter((t) => t.state === "waiting").length,
      next: ready
        .slice(0, NEXT_SHOWN)
        .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
    });
    groups.set(key, group);
  }

  const work = (card: ProjectCard) => card.todo + card.waiting;
  const total = (group: ClientGroup) => group.projects.reduce((sum, card) => sum + work(card), 0);
  return [...groups.values()]
    .map((group) => ({
      ...group,
      projects: [...group.projects].sort(
        (a, b) => work(b) - work(a) || a.name.localeCompare(b.name),
      ),
    }))
    .sort(
      (a, b) =>
        total(b) - total(a) ||
        Number(a.client === null) - Number(b.client === null) ||
        (a.client ?? "").localeCompare(b.client ?? ""),
    );
}

// ── Continuity: where a thing went, and what is new ──────────────────────

/** Every place a chat message points at, with the name to show for each. */
export function chatLinks(
  message: Pick<CoachChatMessage, "link" | "links">,
): { label: string; path: string }[] {
  const links = message.links?.length ? message.links : message.link ? [message.link] : [];
  return links.map((link) => ({ label: link.label?.trim() || "Open", path: linkPath(link) }));
}

/** What became of a text, and the screen that shows it. The owner's own tick comes first. */
export function messageWent(
  message: InboundMessage,
): { label: "Done" | "In a batch" | "Task" | "Request"; path: string | null } | null {
  if (message.handledAt) return { label: "Done", path: null };
  if (message.batchId) return { label: "In a batch", path: `/coach/batch/${message.batchId}` };
  if (message.taskId) return { label: "Task", path: `/coach/task/${message.taskId}` };
  if (message.requestId) return { label: "Request", path: `/coach/request/${message.requestId}` };
  return null;
}

/** The numbers on the nav: tasks to do across projects, and tasks late or due today. */
export function navBadges(up: UpNext | null, today: string): { projects: number; upnext: number } {
  if (!up) return { projects: 0, upnext: 0 };
  const dueToday = up.thisWeek.find((d) => d.date === today)?.tasks.length ?? 0;
  return {
    projects: up.byProject.reduce((sum, p) => sum + p.open, 0),
    upnext: up.overdue.length + dueToday,
  };
}

/**
 * Tasks added since a project was last looked at (`since`). With no record of
 * a look, nothing counts as new: otherwise everything would on first use.
 */
export function newSince<T extends { createdAt: string }>(
  tasks: T[],
  since: string | undefined,
): T[] {
  if (!since) return [];
  return tasks.filter((t) => t.createdAt > since);
}

// ── The work board: every project's tasks by where they stand ────────────

export interface WorkCard {
  key: string;
  title: string;
  /** The project it belongs to, by name. */
  project: string | null;
  path: string;
  dueDate: string | null;
  /** Waiting on another task: cannot be started yet. */
  blocked: boolean;
}

/**
 * Work across projects (or one, with `projectId`) in three columns: to do,
 * waiting on the client, and finished but not yet reported.
 */
export function workBoard(input: {
  tasks: CoachTask[];
  ready: { requests: CoachRequest[]; tasks: CoachTask[] };
  projects: Pick<Project, "id" | "name">[];
  projectId: string | null;
}): { todo: WorkCard[]; waiting: WorkCard[]; ready: WorkCard[] } {
  const name = (id: string | null) => input.projects.find((p) => p.id === id)?.name ?? null;
  const wanted = <T extends { projectId: string | null }>(items: T[]) =>
    items.filter((item) => !input.projectId || item.projectId === input.projectId);
  const card = (task: CoachTask): WorkCard => ({
    key: task.id,
    title: task.title,
    project: name(task.projectId),
    path: `/coach/task/${task.id}`,
    dueDate: task.dueDate,
    blocked: task.blocked,
  });
  const soonest = (a: CoachTask, b: CoachTask) => {
    if (a.blocked !== b.blocked) return Number(a.blocked) - Number(b.blocked);
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  };
  const tasks = wanted(input.tasks);
  return {
    todo: tasks
      .filter((t) => t.state === "open")
      .sort(soonest)
      .map(card),
    waiting: tasks.filter((t) => t.state === "waiting").map(card),
    ready: [
      ...wanted(input.ready.requests).map((request) => ({
        key: request.id,
        title: request.understood,
        project: name(request.projectId),
        path: `/coach/request/${request.id}`,
        dueDate: null,
        blocked: false,
      })),
      ...wanted(input.ready.tasks).map(card),
    ],
  };
}

/** The dates a task is usually moved to, from `today` (YYYY-MM-DD, local). */
export function dateChoices(today: string): { label: string; date: string | null }[] {
  const plus = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: plus(1) },
    { label: "Next week", date: plus(7) },
    { label: "No date", date: null },
  ];
}

/** Where a project stands, in one line of plain words. Zeroes are left out. */
export function standing(tiles: ProjectTile[]): string {
  const words: Record<ProjectTile["key"], (value: string) => string> = {
    todo: (v) => `${v} to do`,
    waiting: (v) => `${v} waiting on them`,
    ready: (v) => `${v} ready to report`,
    heard: (v) => `heard ${v}`,
  };
  const parts = tiles
    .filter((tile) => tile.value !== "0" && tile.value !== "–")
    .map((tile) => words[tile.key](tile.value));
  return parts.length > 0 ? parts.join(" · ") : "Nothing open";
}

// ── Digest: the requests found in a stretch of texts ─────────────────────

/** How many requests were found, and how many still need a task. */
export function digestCounts(groups: DigestGroup[]): { found: number; open: number } {
  const items = groups.flatMap((g) => g.items);
  return { found: items.length, open: items.filter((i) => digestState(i) === "open").length };
}

/** Where a found request stands: already a task, already answered in the thread, or open. */
export function digestState(item: DigestItem): "task" | "answered" | "open" {
  if (item.taskId) return "task";
  return item.answered ? "answered" : "open";
}

/** A request's place in the digest, for selecting it. */
export const digestKey = (group: number, item: number): string => `${group}:${item}`;
