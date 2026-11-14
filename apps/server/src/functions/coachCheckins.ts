import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { checkIn } from "../services/coach/botMessages.js";
import { postBotMessage } from "../services/coach/chat.js";
import { nextCheckIn, type CheckInDay, type CheckInKind } from "../services/coach/checkins.js";
import { workHoursOf } from "../services/coach/reminders.js";
import { sendPush } from "../services/push.js";
import { hhmm, inQuietHours, localParts } from "../services/coach/time.js";

type Row = Record<string, unknown>;
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

export const CHECKIN_JOB = {
  id: "coach-checkins",
  retries: 1,
  triggers: [{ cron: "*/15 * * * *" }],
} as const;

/**
 * Inside the hours she set, check in: what are you on, still on it, a photo at
 * the end. Nothing happens without working hours or a timezone, outside those
 * hours, or once a couple of check-ins have gone unanswered that day.
 *
 * A check-in is a chat message keyed on the day (and time), so two runs in
 * the same window say it once; the notification only goes out when the
 * message was actually new.
 */
export const checkIns = inngest.createFunction(
  CHECKIN_JOB as never,
  (async ({ step }: { step: Step }) => {
    const sent = await step.run("check-in", async () => {
      const now = new Date();
      const { data: users } = await supabase.from("users").select("id").eq("coach_enabled", true);
      let count = 0;

      for (const user of (users as { id: string }[]) ?? []) {
        const { data: settingsRow } = await supabase
          .from("coach_settings")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        const row = settingsRow as Row | null;
        const work = row ? workHoursOf(row) : null;
        // Without a timezone, "09:00" means nothing: do not guess.
        if (!row || !row.timezone || !work) continue;

        const local = localParts(now, row.timezone as string);
        const quietStart = hhmm((row.quiet_start as string) ?? "21:00");
        const quietEnd = hhmm((row.quiet_end as string) ?? "08:00");
        if (inQuietHours(local.time, quietStart, quietEnd)) continue;

        // Today's check-ins so far, from the thread itself.
        const { data: sentToday } = await supabase
          .from("coach_chat_messages")
          .select("ref_id, chosen, created_at")
          .eq("user_id", user.id)
          .eq("kind", "checkin")
          .like("ref_id", `${local.date}:%`)
          .order("created_at", { ascending: true });
        const today =
          (sentToday as { ref_id: string; chosen: number | null; created_at: string }[]) ?? [];
        const last = today.at(-1);

        let ignored = 0;
        if (last) {
          // Typing a reply counts as answering, even with no button tapped.
          const { data: replies } = await supabase
            .from("coach_chat_messages")
            .select("id")
            .eq("user_id", user.id)
            .eq("role", "user")
            .gt("created_at", last.created_at)
            .limit(1);
          if (((replies as unknown[]) ?? []).length === 0) {
            for (let i = today.length - 1; i >= 0 && today[i].chosen === null; i--) ignored++;
          }
        }

        const day: CheckInDay = {
          kinds: today.map((m) => m.ref_id.split(":")[1] as CheckInKind),
          lastAt: last ? localParts(new Date(last.created_at), row.timezone as string).time : null,
          ignored,
        };
        const kind = nextCheckIn(local, work, day);
        if (!kind) continue;

        const { data: projectRows } = await supabase
          .from("coach_projects")
          .select("id, name")
          .eq("user_id", user.id)
          .eq("active", true)
          .order("created_at", { ascending: true });
        const projects = (projectRows as { id: string; name: string }[]) ?? [];
        const focus = projects.find((p) => p.id === row.focus_project_id) ?? null;

        const message = checkIn(kind, { date: local.date, time: local.time, focus, projects });
        const id = await postBotMessage(user.id, message);
        if (!id) continue; // already said in this window

        await sendPush(user.id, {
          title: "Cliphy",
          body: message.text,
          data: { type: "checkin" },
        }).catch(() => {});
        count++;
      }
      return count;
    });
    return { sent };
  }) as never,
);
