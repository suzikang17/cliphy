import { supabase } from "../../lib/supabase.js";

// What the bot is doing right now, in two or three words, for a quiet status
// line in the chat. Derived from state that already exists; nothing is stored.

/** A bundle older than this is stuck, not "being read"; the sweep deals with it. */
const READING_WINDOW_MS = 20 * 60_000;
/** A typed message unanswered for longer than this has failed, not "thinking". */
const THINKING_WINDOW_MS = 2 * 60_000;

export interface ActivityInput {
  bundles: { person_id: string; status: string; last_message_at: string; historical: boolean }[];
  /** When the user's latest message was sent, if the bot has not replied to it. */
  pendingReplyAt: string | null;
  names: Map<string, string>;
}

/** Pure. The reply the user is waiting on comes first, then whose messages are being read. */
export function activityLabels(input: ActivityInput, now: Date): string[] {
  const labels: string[] = [];
  const t = now.getTime();

  if (input.pendingReplyAt && t - Date.parse(input.pendingReplyAt) < THINKING_WINDOW_MS) {
    labels.push("Thinking");
  }

  const seen = new Set<string>();
  for (const b of input.bundles) {
    if (b.historical || (b.status !== "collecting" && b.status !== "processing")) continue;
    if (t - Date.parse(b.last_message_at) >= READING_WINDOW_MS) continue;
    if (seen.has(b.person_id)) continue;
    seen.add(b.person_id);
    const name = input.names.get(b.person_id);
    labels.push(name ? `Reading ${name}'s message` : "Reading a message");
  }
  return labels;
}

export async function loadActivity(userId: string, now: Date = new Date()): Promise<string[]> {
  const [bundlesRes, latestRes, peopleRes] = await Promise.all([
    supabase
      .from("coach_bundles")
      .select("person_id, status, last_message_at, historical")
      .eq("user_id", userId)
      .in("status", ["collecting", "processing"])
      .limit(20),
    supabase
      .from("coach_chat_messages")
      .select("role, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("coach_people").select("id, name").eq("user_id", userId),
  ]);

  const latest = ((latestRes.data as { role: string; created_at: string }[]) ?? [])[0];
  return activityLabels(
    {
      bundles: (bundlesRes.data as ActivityInput["bundles"]) ?? [],
      pendingReplyAt: latest?.role === "user" ? latest.created_at : null,
      names: new Map(
        ((peopleRes.data as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name]),
      ),
    },
    now,
  );
}
