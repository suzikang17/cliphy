import type { BatchItem, CoachBatch, InboundMessage } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { signImageUrl } from "../../lib/storage.js";
import { toMessage } from "../../lib/coachMappers.js";
import { summaryMatches } from "./batchSummary.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toBatchItem(row: Row): BatchItem {
  return {
    id: row.id as string,
    requestId: str(row.request_id),
    messageId: str(row.message_id),
    taskId: str(row.task_id),
    label: (row.label as string) ?? "",
    state: (row.state as BatchItem["state"]) ?? "unchecked",
    note: str(row.note),
  };
}

export function toBatch(row: Row, items: { state?: unknown }[]): CoachBatch {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    projectId: str(row.project_id),
    status: (row.status as CoachBatch["status"]) ?? "checking",
    summary: str(row.summary),
    sentAt: str(row.sent_at),
    createdAt: row.created_at as string,
    itemCount: items.length,
    uncheckedCount: items.filter((i) => (i.state ?? "unchecked") === "unchecked").length,
  };
}

export async function loadBatch(id: string, userId: string): Promise<Row | null> {
  const { data } = await supabase
    .from("coach_batches")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

export async function loadItems(batchId: string, userId: string): Promise<Row[]> {
  const { data } = await supabase
    .from("coach_batch_items")
    .select("*")
    .eq("batch_id", batchId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  return (data as Row[]) ?? [];
}

/**
 * What the client sent for each item, keyed by item id: the messages behind a
 * request, the message itself, or the messages pulled into a task.
 */
export async function messagesForItems(
  items: Row[],
  userId: string,
): Promise<Map<string, InboundMessage[]>> {
  const out = new Map<string, InboundMessage[]>(items.map((i) => [i.id as string, []]));
  const ids = (key: string) => items.map((i) => i[key]).filter(Boolean) as string[];
  const requestIds = ids("request_id");
  const messageIds = ids("message_id");
  const taskIds = ids("task_id");

  const bundleOf = new Map<string, string>(); // request id → bundle id
  if (requestIds.length > 0) {
    const { data } = await supabase
      .from("coach_requests")
      .select("id, bundle_id")
      .eq("user_id", userId)
      .in("id", requestIds);
    for (const r of (data as Row[]) ?? []) bundleOf.set(r.id as string, r.bundle_id as string);
  }

  const linked = new Map<string, string[]>(); // task id → message ids
  if (taskIds.length > 0) {
    const { data } = await supabase
      .from("coach_task_messages")
      .select("task_id, message_id")
      .eq("user_id", userId)
      .in("task_id", taskIds);
    for (const l of (data as Row[]) ?? []) {
      const list = linked.get(l.task_id as string) ?? [];
      list.push(l.message_id as string);
      linked.set(l.task_id as string, list);
    }
  }

  const rows: Row[] = [];
  const bundleIds = [...new Set(bundleOf.values())];
  if (bundleIds.length > 0) {
    const { data } = await supabase
      .from("coach_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("direction", "in")
      .in("bundle_id", bundleIds)
      .order("sent_at", { ascending: true });
    rows.push(...((data as Row[]) ?? []));
  }
  const loose = [...new Set([...messageIds, ...[...linked.values()].flat()])];
  if (loose.length > 0) {
    const { data } = await supabase
      .from("coach_messages")
      .select("*")
      .eq("user_id", userId)
      .in("id", loose)
      .order("sent_at", { ascending: true });
    rows.push(...((data as Row[]) ?? []));
  }

  for (const item of items) {
    const bundleId = item.request_id ? bundleOf.get(item.request_id as string) : undefined;
    const wanted = item.task_id ? (linked.get(item.task_id as string) ?? []) : [];
    const seen = new Set<string>();
    const mine = rows.filter((m) => {
      const hit =
        (bundleId !== undefined && m.bundle_id === bundleId) ||
        (item.message_id !== null && item.message_id !== undefined && m.id === item.message_id) ||
        wanted.includes(m.id as string);
      if (!hit || seen.has(m.id as string)) return false;
      seen.add(m.id as string);
      return true;
    });
    out.set(item.id as string, mine.map(toMessage));
  }
  return out;
}

/** Attachment links expire, so they are signed each time they are shown. */
export async function signAttachments(messages: InboundMessage[]): Promise<void> {
  for (const m of messages) {
    for (const a of m.attachments) a.url = (await signImageUrl(a.storagePath)) ?? undefined;
  }
}

/**
 * The Mac saw messages go out to a client. If one of them is the summary of a
 * batch waiting to be sent, the batch is sent.
 */
export async function noteOutgoing(
  userId: string,
  personId: string,
  texts: string[],
): Promise<void> {
  if (texts.length === 0) return;
  const { data } = await supabase
    .from("coach_batches")
    .select("id, summary")
    .eq("user_id", userId)
    .eq("person_id", personId)
    .eq("status", "ready");
  for (const batch of (data as Row[]) ?? []) {
    const summary = str(batch.summary);
    if (!summary || !texts.some((t) => summaryMatches(t, summary))) continue;
    await supabase
      .from("coach_batches")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", batch.id as string)
      .eq("user_id", userId)
      .eq("status", "ready");
  }
}
