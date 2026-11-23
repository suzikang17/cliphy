/**
 * Read-only check of the YouTube auto-pull (liked videos, playlists, Watch
 * Later, channels) against production: is anything connected, is the poll
 * running, and does YouTube answer.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/check-autopull.ts
 *
 * Writes nothing. Prints counts, types and ages only: no names, emails,
 * titles or tokens.
 */
import { createClient } from "@supabase/supabase-js";
import {
  fetchLikedVideos,
  fetchMyPlaylists,
  fetchPlaylistVideos,
} from "../src/services/youtube.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const age = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 120) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

async function probe(label: string, run: () => Promise<number>) {
  try {
    console.log(`    ${label}: ${await run()}`);
  } catch (err) {
    console.log(`    ${label}: FAILED (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function main() {
  const { data: users } = await supabase.from("users").select("id, plan, last_active_at");
  const label = new Map((users ?? []).map((u, i) => [u.id as string, `user ${i + 1}`]));
  const plan = new Map((users ?? []).map((u) => [u.id as string, u.plan as string]));
  console.log(
    `${users?.length ?? 0} account(s); ${(users ?? []).filter((u) => u.plan === "pro").length} on Pro.`,
  );

  const { data: tokens, error: tokenErr } = await supabase
    .from("user_google_tokens")
    .select("user_id, access_token, refresh_token, expires_at, scopes, created_at, updated_at");
  if (tokenErr) throw new Error(`Could not read Google connections: ${tokenErr.message}`);
  console.log(`\nGoogle connections: ${tokens?.length ?? 0}`);

  for (const t of tokens ?? []) {
    const who = label.get(t.user_id as string) ?? "unknown user";
    const live = new Date(t.expires_at as string).getTime() > Date.now() + 30_000;
    console.log(
      `  ${who} (${plan.get(t.user_id as string)}): connected ${age(t.created_at as string)}, ` +
        `token refreshed ${age(t.updated_at as string)}, ` +
        `${live ? "token live" : "token EXPIRED"}, ` +
        `${t.refresh_token ? "can refresh" : "NO refresh token"}, ` +
        `scope ${String(t.scopes).includes("youtube.readonly") ? "ok" : "MISSING youtube.readonly"}`,
    );
    if (!live) {
      console.log("    (skipping the YouTube calls: the stored token has run out)");
      continue;
    }
    const token = t.access_token as string;
    await probe("liked videos YouTube returns", async () => (await fetchLikedVideos(token)).length);
    await probe(
      "Watch Later videos YouTube returns",
      async () => (await fetchPlaylistVideos("WL", token)).length,
    );
    let named = 0;
    await probe("own playlists", async () => {
      const lists = await fetchMyPlaylists(token);
      named = lists.filter((p) => /cliphy/i.test(p.title)).length;
      return lists.length;
    });
    console.log(`    of those, named "Cliphy": ${named}`);
  }

  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, user_id, type, is_active, last_checked_at, skipped_count, created_at")
    .order("created_at", { ascending: true });
  if (subErr) throw new Error(`Could not read subscriptions: ${subErr.message}`);
  console.log(`\nSubscriptions: ${subs?.length ?? 0}`);

  for (const s of subs ?? []) {
    const { count } = await supabase
      .from("subscription_seen_videos")
      .select("youtube_video_id", { count: "exact", head: true })
      .eq("subscription_id", s.id);
    const { data: newest } = await supabase
      .from("subscription_seen_videos")
      .select("seen_at")
      .eq("subscription_id", s.id)
      .order("seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    console.log(
      `  ${label.get(s.user_id as string) ?? "unknown user"} · ${s.type} · ` +
        `${s.is_active ? "on" : "OFF"} · made ${age(s.created_at as string)} · ` +
        `last checked ${age(s.last_checked_at as string | null)} · ` +
        `${count ?? 0} video(s) seen, newest ${age((newest?.seen_at as string) ?? null)} · ` +
        `${s.skipped_count} skipped for the monthly limit`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
