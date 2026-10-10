import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { purgeExpiredTrail } from "../services/trail.js";

const log = logger.child({ fn: "purge-trail" });

// Daily 03:30 UTC: delete trail entries older than each user's chosen retention.
// Users with no retention set (the default) keep their trail forever.
export const purgeTrailCron = inngest.createFunction(
  { id: "purge-trail-cron", triggers: [{ cron: "30 3 * * *" }] },
  async ({ step }) => {
    const deleted = await step.run("purge", () => purgeExpiredTrail());
    log.info("Purged expired trail entries", { deleted });
    return { deleted };
  },
);
