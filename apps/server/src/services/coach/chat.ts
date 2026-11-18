import type { Attachment, ChatButton, ChatLink, CoachChatMessage } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import type { BotMessage } from "./botMessages.js";

type Row = Record<string, unknown>;

/**
 * The `link` column holds one link or a list of them. Both shapes are given:
 * `links` for screens that show them all, `link` (the first) for older ones.
 */
function linksOf(stored: unknown): { link: ChatLink | null; links: ChatLink[] } {
  const links = (Array.isArray(stored) ? stored : stored ? [stored] : []) as ChatLink[];
  return { link: links[0] ?? null, links };
}

export function toChatMessage(row: Row): CoachChatMessage {
  return {
    id: row.id as string,
    role: row.role as CoachChatMessage["role"],
    text: (row.text as string) ?? "",
    attachments: (row.attachments as Attachment[]) ?? [],
    buttons: (row.buttons as ChatButton[]) ?? [],
    ...linksOf(row.link),
    chosen: typeof row.chosen === "number" ? row.chosen : null,
    kind: row.kind as CoachChatMessage["kind"],
    createdAt: row.created_at as string,
  };
}

/**
 * Add a bot message to the user's thread.
 *
 * A message about a particular thing (`refId`) is posted once: if the thread
 * already has it, nothing is written and null is returned. That makes every
 * job that posts safe to retry.
 */
export async function postBotMessage(userId: string, msg: BotMessage): Promise<string | null> {
  const row = {
    user_id: userId,
    role: "bot",
    text: msg.text,
    attachments: msg.attachments,
    buttons: msg.buttons,
    // Several links are stored as a list; one, as itself.
    link: msg.links && msg.links.length > 1 ? msg.links : (msg.links?.[0] ?? msg.link),
    kind: msg.kind,
    ref_id: msg.refId,
  };
  const query = msg.refId
    ? supabase
        .from("coach_chat_messages")
        .upsert(row, { onConflict: "user_id,kind,ref_id", ignoreDuplicates: true })
    : supabase.from("coach_chat_messages").insert(row);
  const { data, error } = await query.select("id");
  // An error must not look like "already in the thread": the caller would
  // carry on believing it was said. Throw, so the job retries.
  if (error) throw new Error("Could not save chat message");
  return ((data as { id: string }[] | null) ?? [])[0]?.id ?? null;
}

export async function postUserMessage(userId: string, text: string): Promise<string | null> {
  const { data } = await supabase
    .from("coach_chat_messages")
    .insert({ user_id: userId, role: "user", text, kind: "user" })
    .select("id");
  return ((data as { id: string }[] | null) ?? [])[0]?.id ?? null;
}

/** The thread, oldest first. `after` returns only what is newer than that time. */
export async function listMessages(
  userId: string,
  opts: { after?: string; limit?: number } = {},
): Promise<CoachChatMessage[]> {
  let query = supabase.from("coach_chat_messages").select("*").eq("user_id", userId);
  if (opts.after) query = query.gt("created_at", opts.after);
  const { data } = await query
    .order("created_at", { ascending: opts.after !== undefined })
    .limit(Math.min(opts.limit ?? 50, 200));
  const messages = ((data as Row[]) ?? []).map(toChatMessage);
  // Without `after` the newest page is fetched newest-first; show it oldest-first.
  return opts.after !== undefined ? messages : messages.reverse();
}
