import { supabase } from "../../lib/supabase.js";

type Row = Record<string, unknown>;

/** What has become of a message, beyond its own words. */
export interface MessageMarks {
  /** When the owner checked it off by hand. */
  handledAt: string | null;
  /** The request its bundle was read into, if any. */
  requestId: string | null;
  /** The batch it sits in, unless it was carried out of that batch. */
  batchId: string | null;
  /** A task it was pulled into, if any. */
  taskId: string | null;
}

/** Marks for a page of message rows, keyed by message id. Three reads, whatever the page size. */
export async function messageMarks(
  rows: Row[],
  userId: string,
): Promise<Map<string, MessageMarks>> {
  const ids = rows.map((r) => r.id as string);
  const bundleIds = [...new Set(rows.map((r) => r.bundle_id as string | null).filter(Boolean))];

  const [requests, items, tasks] = await Promise.all([
    bundleIds.length > 0
      ? supabase
          .from("coach_requests")
          .select("id, bundle_id")
          .eq("user_id", userId)
          .in("bundle_id", bundleIds)
      : { data: [] },
    ids.length > 0
      ? supabase
          .from("coach_batch_items")
          .select("message_id, batch_id, state")
          .eq("user_id", userId)
          .in("message_id", ids)
      : { data: [] },
    ids.length > 0
      ? supabase
          .from("coach_task_messages")
          .select("message_id, task_id")
          .eq("user_id", userId)
          .in("message_id", ids)
      : { data: [] },
  ]);
  const taskOf = new Map(
    ((tasks.data as Row[]) ?? []).map((t) => [t.message_id as string, t.task_id as string]),
  );

  const requestOf = new Map(
    ((requests.data as Row[]) ?? []).map((r) => [r.bundle_id as string, r.id as string]),
  );
  const batchOf = new Map(
    ((items.data as Row[]) ?? [])
      .filter((i) => i.state !== "not_done")
      .map((i) => [i.message_id as string, i.batch_id as string]),
  );

  return new Map(
    rows.map((r) => [
      r.id as string,
      {
        handledAt: (r.handled_at as string) ?? null,
        requestId: requestOf.get(r.bundle_id as string) ?? null,
        batchId: batchOf.get(r.id as string) ?? null,
        taskId: taskOf.get(r.id as string) ?? null,
      },
    ]),
  );
}
