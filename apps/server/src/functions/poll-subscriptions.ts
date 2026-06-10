import type { EventPayload } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { discoverCliphyPlaylists, pollAndQueueSubscription } from "../services/subscriptions.js";

const log = logger.child({ fn: "poll-subscriptions" });

// Cron: fires every 15 minutes, fans out one event per active subscription
export const pollSubscriptionsCron = inngest.createFunction(
  { id: "poll-subscriptions-cron", triggers: [{ cron: "*/15 * * * *" }] },
  async () => {
    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("is_active", true);

    if (error) {
      log.error(
        "Failed to fetch active subscriptions",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    const rows = subs ?? [];
    if (rows.length > 0) {
      await inngest.send(
        rows.map((sub) => ({
          name: "subscription/poll.requested" as const,
          data: { subscriptionId: sub.id as string },
        })),
      );
    }

    // Fan out playlist discovery for every user with a connected Google account
    const { data: tokenRows } = await supabase.from("user_google_tokens").select("user_id");
    const users = tokenRows ?? [];
    if (users.length > 0) {
      await inngest.send(
        users.map((u) => ({
          name: "subscription/discover.requested" as const,
          data: { userId: u.user_id as string },
        })),
      );
    }

    log.info("Dispatched subscription poll events", {
      count: rows.length,
      discoveryCount: users.length,
    });
    return { dispatched: rows.length, discoveryDispatched: users.length };
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
