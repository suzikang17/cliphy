import { Hono, type Context } from "hono";
import type { RunOutcome } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import {
  cancelRun,
  checkInRun,
  claimRun,
  finishRun,
  latestRun,
  startRun,
} from "../../services/coach/runs.js";

// Runs of the website task runner. Starting and stopping belong to the phone:
// a run exists only because the owner tapped. Claim, check in and finish
// belong to the runner, and are everything a runner has to speak.

export const runRoutes = new Hono<AppEnv>();

const byKey = (c: Context<AppEnv>) => c.get("authMethod") === "api_key";
const phoneOnly = { error: "Sign in on the phone to do this" };
const runnerOnly = { error: "Only a runner can do this" };

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https:\/\/\S+$/.test(v);
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const isText = (v: unknown): boolean => typeof v === "string";

/** The outcome a runner sent, or null when it is not one. Pictures must be in the user's own folder. */
function readOutcome(body: Record<string, unknown>, userId: string): RunOutcome | null {
  if (body.status !== "done" && body.status !== "failed") return null;
  if (!optional(body.summary, isText) || !optional(body.error, isText)) return null;
  if (!optional(body.branch, isText)) return null;
  if (!optional(body.prUrl, isUrl) || !optional(body.previewUrl, isUrl)) return null;

  const pictures: NonNullable<RunOutcome["pictures"]> = [];
  if (body.pictures !== undefined) {
    if (!Array.isArray(body.pictures) || body.pictures.length > 8) return null;
    for (const p of body.pictures as Record<string, unknown>[]) {
      const path = p?.storagePath;
      if (
        (p?.label !== "before" && p?.label !== "after") ||
        (p?.width !== "phone" && p?.width !== "desktop") ||
        typeof path !== "string" ||
        !path.startsWith(`coach/${userId}/`) ||
        path.split("/").includes("..")
      ) {
        return null;
      }
      pictures.push({ label: p.label, width: p.width, storagePath: path });
    }
  }
  return {
    status: body.status,
    summary: body.summary as string | undefined,
    branch: body.branch as string | undefined,
    prUrl: body.prUrl as string | undefined,
    previewUrl: body.previewUrl as string | undefined,
    pictures,
    error: body.error as string | undefined,
  };
}

const bodyOf = async (c: Context<AppEnv>): Promise<Record<string, unknown>> =>
  (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};

// ── The phone ────────────────────────────────────────────────────────────

runRoutes.post("/", async (c) => {
  if (byKey(c)) return c.json(phoneOnly, 403);
  const { taskId } = await bodyOf(c);
  if (typeof taskId !== "string") return c.json({ error: "taskId is required" }, 400);
  const result = await startRun(c.get("userId"), taskId);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, result.status);
});

runRoutes.post("/:id/cancel", async (c) => {
  if (byKey(c)) return c.json(phoneOnly, 403);
  const result = await cancelRun(c.get("userId"), c.req.param("id"));
  if (!result) return c.json({ error: "run not found" }, 404);
  return c.json({ run: result.run });
});

runRoutes.get("/", async (c) => {
  const taskId = c.req.query("taskId");
  if (!taskId) return c.json({ error: "taskId is required" }, 400);
  return c.json({ run: await latestRun(c.get("userId"), taskId) });
});

// ── The runner ───────────────────────────────────────────────────────────

runRoutes.post("/claim", async (c) => {
  if (!byKey(c)) return c.json(runnerOnly, 403);
  const claimed = await claimRun(c.get("userId"));
  return c.json(claimed ?? { run: null });
});

runRoutes.post("/:id/checkin", async (c) => {
  if (!byKey(c)) return c.json(runnerOnly, 403);
  const { note } = await bodyOf(c);
  const result = await checkInRun(
    c.get("userId"),
    c.req.param("id"),
    typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null,
  );
  if (!result) return c.json({ error: "run not found" }, 404);
  return c.json(result);
});

runRoutes.post("/:id/finish", async (c) => {
  if (!byKey(c)) return c.json(runnerOnly, 403);
  const userId = c.get("userId");
  const outcome = readOutcome(await bodyOf(c), userId);
  if (!outcome) return c.json({ error: "not a run outcome" }, 400);
  const result = await finishRun(userId, c.req.param("id"), outcome);
  if (!result) return c.json({ error: "run not found" }, 404);
  return c.json({ run: result.run });
});
