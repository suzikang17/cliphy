import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { checkIn } from "../services/coach/botMessages.js";
import { postBotMessage } from "../services/coach/chat.js";
import {
  countIgnored,
  nextCheckIn,
  type CheckInDay,
  type CheckInKind,
} from "../services/coach/checkins.js";
import { workHoursOf } from "../services/coach/reminders.js";
import { sendPush } from "../services/push.js";
import { hhmm, inQuietHours, localParts, zonedToUtc } from "../services/coach/time.js";

const log = logger.child({ fn: "coach-checkins" });

type Row = Record<string, unknown>;
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

/** Do not interrupt someone who wrote to the bot this recently. */
const RECENTLY_MS = 10 * 60_000;

export const CHECKIN_JOB = {
  id: "coach-checkins",
  retries: 1,
  triggers: [{ cron: "*/15 * * * *" }],
} as const;

/** Check in with one user if it is the moment to. Returns whether a check-in went out. */
async function checkInWith(userId: string, now: Date): Promise<boolean> {
  const { data: settingsRow } = await supabase
    .from("coach_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const row = settingsRow as Row | null;
  const work = row ? workHoursOf(row) : null;
  // Without a timezone, "09:00" means nothing: do not guess.
  if (!row || !row.timezone || !work) return false;
  const timezone = row.timezone as string;

  const local = localParts(now, timezone);
  const quietStart = hhmm((row.quiet_start as string) ?? "21:00");
  const quietEnd = hhmm((row.quiet_end as string) ?? "08:00");
  if (inQuietHours(local.time, quietStart, quietEnd)) return false;

  const dayStart = zonedToUtc(local.date, "00:00", timezone).toISOString();
  const [sentRes, typedRes, photoRes] = await Promise.all([
    // Today's check-ins so far, from the thread itself.
    supabase
      .from("coach_chat_messages")
      .select("ref_id, chosen, created_at")
      .eq("user_id", userId)
      .eq("kind", "checkin")
      .like("ref_id", `${local.date}:%`)
      .order("created_at", { ascending: true }),
    // What she typed today: a typed reply answers a check-in as well as a tap does.
    supabase
      .from("coach_chat_messages")
      .select("created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", dayStart)
      .order("created_at", { ascending: true }),
    supabase
      .from("coach_progress")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", dayStart)
      .limit(1),
  ]);
  const today =
    (sentRes.data as { ref_id: string; chosen: number | null; created_at: string }[]) ?? [];
  const typed = ((typedRes.data as { created_at: string }[]) ?? []).map((m) => m.created_at);

  // She is talking to the bot right now: a check-in would be an interruption.
  const lastTyped = typed.at(-1);
  if (lastTyped && now.getTime() - Date.parse(lastTyped) < RECENTLY_MS) return false;

  const last = today.at(-1);
  const day: CheckInDay = {
    kinds: today.map((m) => m.ref_id.split(":")[1] as CheckInKind),
    lastAt: last ? localParts(new Date(last.created_at), timezone).time : null,
    ignored: countIgnored(
      today.map((m) => ({ createdAt: m.created_at, chosen: m.chosen })),
      typed,
      now.toISOString(),
    ),
    photoToday: ((photoRes.data as unknown[]) ?? []).length > 0,
  };
  const kind = nextCheckIn(local, work, day);
  if (!kind) return false;

  const { data: projectRows } = await supabase
    .from("coach_projects")
    .select("id, name")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  const projects = (projectRows as { id: string; name: string }[]) ?? [];
  const focus = projects.find((p) => p.id === row.focus_project_id) ?? null;

  const message = checkIn(kind, {
    date: local.date,
    ordinal: day.kinds.filter((k) => k === "during").length + 1,
    focus,
    projects,
  });
  const id = await postBotMessage(userId, message);
  if (!id) return false; // already said in this window

  await sendPush(userId, {
    title: "Cliphy",
    body: message.text,
    data: { type: "checkin" },
  }).catch(() => {});
  return true;
}

/**
 * Inside the hours she set, check in: what are you on, still on it, a photo at
 * the end. Nothing happens without working hours or a timezone, outside those
 * hours, while she is mid-conversation with the bot, or once a couple of
 * check-ins have gone unanswered that day.
 *
 * A check-in is a chat message keyed on the day and its place in it, so two
 * runs in the same window say it once; the notification only goes out when
 * the message was actually new.
 */
export const checkIns = inngest.createFunction(
  CHECKIN_JOB as never,
  (async ({ step }: { step: Step }) => {
    const sent = await step.run("check-in", async () => {
      const now = new Date();
      const { data: users } = await supabase.from("users").select("id").eq("coach_enabled", true);
      let count = 0;
      for (const user of (users as { id: string }[]) ?? []) {
        try {
          if (await checkInWith(user.id, now)) count++;
        } catch (err) {
          // One person's bad settings must not stop everyone after them.
          log.warn("Check-in failed", { userId: user.id, err: String(err) });
        }
      }
      return count;
    });
    return { sent };
  }) as never,
);
