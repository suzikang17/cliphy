import type { EventPayload } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { discoverCliphyPlaylists, pollAndQueueSubscription } from "../services/subscriptions.js";

const log = logger.child({ fn: "poll-subscriptions" });

/** Users inactive longer than this poll daily instead of every cycle. */
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Cron: fires every 15 minutes, fans out one event per active subscription.
// YouTube-quota backoff: subscriptions of users dormant >14 days poll only on
// the daily (00:00 UTC) cycle; playlist discovery runs on hourly cycles only.
// The app-open refresh endpoint covers returning users instantly either way.
export const pollSubscriptionsCron = inngest.createFunction(
  { id: "poll-subscriptions-cron", triggers: [{ cron: "*/15 * * * *" }] },
  async () => {
    const now = new Date();
    const hourlyCycle = now.getUTCMinutes() < 15;
    const dailyCycle = hourlyCycle && now.getUTCHours() === 0;

    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("id, users!inner(last_active_at)")
      .eq("is_active", true);

    if (error) {
      log.error(
        "Failed to fetch active subscriptions",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    const activeCutoff = now.getTime() - ACTIVE_WINDOW_MS;
    const rows = (subs ?? []).filter((sub) => {
      const lastActive = (sub.users as { last_active_at: string | null } | null)?.last_active_at;
      // No signal yet (pre-migration users) → keep polling every cycle
      if (!lastActive) return true;
      return new Date(lastActive).getTime() >= activeCutoff || dailyCycle;
    });
    if (rows.length > 0) {
      await inngest.send(
        rows.map((sub) => ({
          name: "subscription/poll.requested" as const,
          data: { subscriptionId: sub.id as string },
        })),
      );
    }

    // Fan out playlist discovery for every user with a connected Google
    // account — hourly is plenty for "did they create a Cliphy playlist"
    let discoveryCount = 0;
    if (hourlyCycle) {
      const { data: tokenRows } = await supabase.from("user_google_tokens").select("user_id");
      const users = tokenRows ?? [];
      discoveryCount = users.length;
      if (users.length > 0) {
        await inngest.send(
          users.map((u) => ({
            name: "subscription/discover.requested" as const,
            data: { userId: u.user_id as string },
          })),
        );
      }
    }

    log.info("Dispatched subscription poll events", {
      count: rows.length,
      skipped: (subs ?? []).length - rows.length,
      discoveryCount,
    });
    return { dispatched: rows.length, discoveryDispatched: discoveryCount };
  },
);

// Worker: scans one user's playlists for "cliphy"-named ones and auto-subscribes
export const processPlaylistDiscovery = inngest.createFunction(
  {
    id: "process-playlist-discovery",
    retries: 1,
    triggers: [{ event: "subscription/discover.requested" }],
  },
  async ({ event }: { event: EventPayload & { data: { userId: string } } }) => {
    const { userId } = event.data;
    const created = await discoverCliphyPlaylists(userId);
    return { userId, created };
  },
);

// Worker: processes a single subscription poll
export const processSubscriptionPoll = inngest.createFunction(
  {
    id: "process-subscription-poll",
    retries: 2,
    triggers: [{ event: "subscription/poll.requested" }],
  },
  async ({ event }: { event: EventPayload & { data: { subscriptionId: string } } }) => {
    const { subscriptionId } = event.data;
    await pollAndQueueSubscription(subscriptionId);
    return { subscriptionId };
  },
);
