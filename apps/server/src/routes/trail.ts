import { Hono } from "hono";
import type { TrailCaptureItem } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { toClip } from "../lib/mappers.js";
import { quickSave } from "../services/quick-save.js";
import {
  MAX_CAPTURE_BATCH,
  MAX_RETENTION_DAYS,
  captureTrail,
  deleteTrailItem,
  getRetentionDays,
  getTrailItem,
  listTrail,
  setRetentionDays,
} from "../services/trail.js";

const CAPTURE_LIMIT_PER_HOUR = 240;
const MAX_LIST = 100;

export const trailRoutes = new Hono<AppEnv>();
trailRoutes.use("*", authMiddleware);

function parseItem(raw: unknown): TrailCaptureItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || r.url.length > 2048 || !/^https?:\/\//.test(r.url)) return null;
  if (typeof r.closedAt !== "number" || !Number.isFinite(r.closedAt)) return null;
  return {
    url: r.url,
    title: typeof r.title === "string" ? r.title : "",
    closedAt: r.closedAt,
    ...(typeof r.openedAt === "number" && Number.isFinite(r.openedAt) && { openedAt: r.openedAt }),
    ...(typeof r.customTitle === "string" && { customTitle: r.customTitle.trim().slice(0, 200) }),
    ...(typeof r.note === "string" && { note: r.note.trim().slice(0, 500) }),
  };
}

// ── POST / — capture closed tabs (batched by the extension) ──

trailRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > MAX_CAPTURE_BATCH
  ) {
    return c.json({ error: `items must be a non-empty array (max ${MAX_CAPTURE_BATCH})` }, 400);
  }
  const items = body.items.map(parseItem).filter((i): i is TrailCaptureItem => i !== null);
  if (items.length === 0) return c.json({ saved: 0 });
  if (!checkRateLimit(`trail:${userId}`, CAPTURE_LIMIT_PER_HOUR, 60 * 60_000)) {
    return c.json({ error: "Too many requests", code: "RATE_LIMITED" }, 429);
  }
  return c.json({ saved: await captureTrail(userId, items) });
});

// ── GET / — list / search, newest first ─────────────────────

trailRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(MAX_LIST, Math.max(1, Number(c.req.query("limit")) || 50));
  const before = c.req.query("before");
  if (before && Number.isNaN(Date.parse(before))) return c.json({ error: "Invalid before" }, 400);
  try {
    return c.json(
      await listTrail(userId, {
        q: c.req.query("q")?.slice(0, 200),
        tag: c.req.query("tag")?.slice(0, 60),
        before,
        limit,
      }),
    );
  } catch {
    return c.json({ error: "Failed to load trail" }, 500);
  }
});

// ── Settings (registered before /:id) ───────────────────────

trailRoutes.get("/settings", async (c) => {
  return c.json({ retentionDays: await getRetentionDays(c.get("userId")) });
});

trailRoutes.put("/settings", async (c) => {
  const userId = c.get("userId");
  let body: { retentionDays?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const days = body.retentionDays;
  const valid =
    days === null ||
    (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS);
  if (!valid) {
    return c.json(
      { error: `retentionDays must be null or an integer 1–${MAX_RETENTION_DAYS}` },
      400,
    );
  }
  try {
    await setRetentionDays(userId, days as number | null);
  } catch {
    return c.json({ error: "Failed to save trail settings" }, 500);
  }
  return c.json({ retentionDays: days });
});

// ── DELETE /:id ──────────────────────────────────────────────

trailRoutes.delete("/:id", async (c) => {
  const ok = await deleteTrailItem(c.get("userId"), c.req.param("id"));
  return ok ? c.json({ deleted: true }) : c.json({ error: "Not found" }, 404);
});

// ── POST /:id/promote — save to clips, drop from the trail ───

trailRoutes.post("/:id/promote", async (c) => {
  const userId = c.get("userId");
  const item = await getTrailItem(userId, c.req.param("id"));
  if (!item) return c.json({ error: "Not found" }, 404);
  const r = await quickSave({
    userId,
    url: item.url,
    title: item.customTitle || item.title,
    note: item.note,
  });
  if (!r.ok) return c.json(r.body, r.status);
  await deleteTrailItem(userId, item.id);
  return c.json({ clip: toClip(r.clip), tags: r.tags }, r.duplicate ? 200 : 201);
});
