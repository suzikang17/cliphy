import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ service: "push" });

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  title: string;
  body: string;
  /** Carried to the app untouched, e.g. `{ type: "reminder", reminderId }`. */
  data: Record<string, unknown>;
}

interface Ticket {
  status: "ok" | "error";
  details?: { error?: string };
}

/**
 * Send one notification to all of a user's devices through the Expo push
 * service. Tokens the service says are gone are removed.
 *
 * `sent` counts tokens the service accepted. Accepted is not delivered: the
 * phone reports delivery itself (see the reminders routes). Throws when the
 * service cannot be reached, so the caller can retry.
 */
export async function sendPush(
  userId: string,
  message: PushMessage,
): Promise<{ sent: number; dead: number }> {
  const { data } = await supabase.from("push_tokens").select("token").eq("user_id", userId);
  const tokens = ((data as { token: string }[]) ?? []).map((r) => r.token);
  if (tokens.length === 0) return { sent: 0, dead: 0 };

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data,
        sound: "default",
      })),
    ),
  });
  if (!res.ok) throw new Error(`Push service returned ${res.status}`);

  const tickets = ((await res.json()) as { data?: Ticket[] }).data ?? [];
  let sent = 0;
  let dead = 0;
  for (const [i, ticket] of tickets.entries()) {
    if (ticket.status === "ok") {
      sent++;
    } else if (ticket.details?.error === "DeviceNotRegistered") {
      dead++;
      await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", tokens[i]);
    } else {
      log.warn("Push not accepted", { userId, error: ticket.details?.error });
    }
  }
  return { sent, dead };
}
