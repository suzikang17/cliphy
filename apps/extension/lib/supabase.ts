import type { Summary } from "@cliphy/shared";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

/** Map a DB row (snake_case) from Realtime payload to a Summary (camelCase). */
export function toSummary(row: Record<string, unknown>): Summary {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    videoId: row.youtube_video_id as string,
    videoTitle: (row.video_title as string) ?? undefined,
    videoUrl: (row.video_url as string) ?? undefined,
    videoChannel: (row.video_channel as string) ?? undefined,
    videoDurationSeconds: (row.video_duration_seconds as number) ?? undefined,
    status: row.status as Summary["status"],
    summaryJson: (row.summary_json as Summary["summaryJson"]) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
    deletedAt: (row.deleted_at as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function startRealtimeSubscription(
  userId: string,
  onChange: (summary: Summary) => void,
  accessToken?: string,
): void {
  stopRealtimeSubscription();

  const supabase = getSupabaseClient();
  if (accessToken) {
    supabase.realtime.setAuth(accessToken);
  }
  const filter = `user_id=eq.${userId}`;
  channel = supabase
    .channel("summaries-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "summaries", filter },
      (payload) => onChange(toSummary(payload.new as Record<string, unknown>)),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "summaries", filter },
      (payload) => onChange(toSummary(payload.new as Record<string, unknown>)),
    )
    .subscribe();
}

export function stopRealtimeSubscription(): void {
  if (channel) {
    const supabase = getSupabaseClient();
    supabase.removeChannel(channel);
    channel = null;
  }
}
