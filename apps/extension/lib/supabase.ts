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

export function startRealtimeSubscription(
  userId: string,
  onChange: (payload: Record<string, unknown>) => void,
): void {
  stopRealtimeSubscription();

  const supabase = getSupabaseClient();
  channel = supabase
    .channel("summaries-changes")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "summaries",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onChange(payload.new as Record<string, unknown>);
      },
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
