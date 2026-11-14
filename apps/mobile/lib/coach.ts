import type { CoachChatMessage, CoachHealth, CoachReminder, Person } from "@cliphy/shared";

// Everything the coach screens decide, kept out of the screens so it can be
// tested without a device.

/** Prefix of a message shown before the server has stored it. */
export const LOCAL_PREFIX = "local-";

/**
 * How long after its time a reminder's local copy fires. The push normally
 * arrives first and cancels the copy; the copy is the backup for no signal.
 */
export const MIRROR_DELAY_MS = 2 * 60_000;

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

export const mirrorId = (reminderId: string): string => `coach-${reminderId}`;

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
    const identifier = mirrorId(r.id);
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
