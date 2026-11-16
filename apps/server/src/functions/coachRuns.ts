import type { CoachRun } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { runnerQuiet } from "../services/coach/botMessages.js";
import { postBotMessage } from "../services/coach/chat.js";
import { announceFinished, toRun } from "../services/coach/runs.js";

const log = logger.child({ fn: "coach-runs-sweep" });

type Row = Record<string, unknown>;
type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

/** A working run whose runner has not checked in for this long has lost its runner. */
export const RUN_STALE_MS = 15 * 60_000;
/** A run nobody has picked up after this long: the runner is probably off. */
export const RUN_UNCLAIMED_MS = 30 * 60_000;

export const RUN_SWEEP_JOB = {
  id: "coach-runs-sweep",
  retries: 1,
  triggers: [{ cron: "*/5 * * * *" }],
} as const;

/**
 * Nothing fails silently: a run whose runner went quiet is failed and Chat is
 * told; a run nobody picked up gets one message saying the runner seems off.
 * Both messages are keyed on the run, so sweeping again says nothing new.
 */
export async function sweepRuns(now: Date): Promise<{ failed: number; quiet: number }> {
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
  let failed = 0;
  let quiet = 0;

  const { data: stale } = await supabase
    .from("coach_runs")
    .select("id, user_id")
    .eq("status", "working")
    .lt("seen_at", before(RUN_STALE_MS));
  for (const row of (stale as Row[]) ?? []) {
    try {
      // Guarded on "still working": a finish that arrived just now wins.
      const { data } = await supabase
        .from("coach_runs")
        .update({
          status: "failed",
          error: "The runner stopped responding.",
          finished_at: now.toISOString(),
        })
        .eq("id", row.id as string)
        .eq("status", "working")
        .select("*")
        .maybeSingle();
      if (!data) continue;
      const run: CoachRun = toRun(data as Row);
      await announceFinished(row.user_id as string, run);
      failed += 1;
    } catch (err) {
      log.warn("Could not fail a stale run", { runId: row.id, err: String(err) });
    }
  }

  const { data: waiting } = await supabase
    .from("coach_runs")
    .select("id, user_id")
    .eq("status", "queued")
    .lt("created_at", before(RUN_UNCLAIMED_MS));
  for (const row of (waiting as Row[]) ?? []) {
    try {
      await postBotMessage(row.user_id as string, runnerQuiet({ id: row.id as string }));
      quiet += 1;
    } catch (err) {
      log.warn("Could not say the runner is quiet", { runId: row.id, err: String(err) });
    }
  }
  return { failed, quiet };
}

export const sweepRunsJob = inngest.createFunction(
  RUN_SWEEP_JOB as never,
  (async ({ step }: { step: Step }) => step.run("sweep", () => sweepRuns(new Date()))) as never,
);
