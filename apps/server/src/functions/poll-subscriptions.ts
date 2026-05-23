import type { EventPayload } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { pollAndQueueSubscription } from "../services/subscriptions.js";

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
    if (rows.length === 0) return { dispatched: 0 };

    await inngest.send(
      rows.map((sub) => ({
        name: "subscription/poll.requested" as const,
        data: { subscriptionId: sub.id as string },
      })),
    );

    log.info("Dispatched subscription poll events", { count: rows.length });
    return { dispatched: rows.length };
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
