import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { sanitizeSearchQuery } from "../lib/validation.js";
import {
  FREE_HISTORY_DAYS,
  MAX_TAGS_PER_SUMMARY,
  MAX_FREE_UNIQUE_TAGS,
  TAG_MAX_LENGTH,
} from "@cliphy/shared";
import type { Summary } from "@cliphy/shared";

export const summaryRoutes = new Hono<AppEnv>();

// Apply auth to all summary routes
summaryRoutes.use("*", authMiddleware);

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Map a DB row (snake_case) to a Summary object (camelCase). */
function toSummary(row: Record<string, unknown>): Summary {
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
    tags: (row.tags as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function clampLimit(raw: string | undefined): number {
  const n = Number(raw) || DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  const n = Number(raw) || 0;
  return Math.max(0, n);
}

/** Look up the user's plan tier. Returns 'free' if not found. */
async function getUserPlan(userId: string): Promise<"free" | "pro"> {
  const { data } = await supabase.from("users").select("plan").eq("id", userId).single();
  return (data?.plan as "free" | "pro") ?? "free";
}

// ── GET /search — Search across summaries ────────────────────
// Registered BEFORE /:id so "search" isn't captured as an :id param.

summaryRoutes.get("/search", async (c) => {
  const userId = c.get("userId");
  const rawQ = c.req.query("q")?.trim();

  if (!rawQ) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const q = sanitizeSearchQuery(rawQ);
  if (!q) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const limit = clampLimit(c.req.query("limit"));
  const offset = parseOffset(c.req.query("offset"));
  const plan = await getUserPlan(userId);

  // Build the base query — only completed, non-deleted, owned by user
  let query = supabase
    .from("summaries")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", "completed")
    .is("deleted_at", null)
    .or(`video_title.ilike.%${q}%,summary_json->>summary.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Free users: restrict to last 7 days
  if (plan === "free") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FREE_HISTORY_DAYS);
    query = query.gte("created_at", cutoff.toISOString());
  }

  const { data, count, error } = await query;

  if (error) {
    return c.json({ error: "Failed to search summaries" }, 500);
  }

  return c.json({
    summaries: (data ?? []).map((r) => toSummary(r as Record<string, unknown>)),
    total: count ?? 0,
    offset,
    limit,
  });
});

// ── GET /tags — List user's unique tags ───────────────────────

summaryRoutes.get("/tags", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("summaries")
    .select("tags")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    return c.json({ error: "Failed to fetch tags" }, 500);
  }

  const tagSet = new Set<string>();
  for (const row of rows ?? []) {
    for (const tag of (row.tags as string[]) ?? []) {
      tagSet.add(tag);
    }
  }
  return c.json({ tags: [...tagSet].sort() });
});

// ── PATCH /:id/tags — Update tags on a summary ──────────────

summaryRoutes.patch("/:id/tags", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const body = await c.req.json<{ tags: unknown }>();

  // Validate tags is an array of strings
  if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string")) {
    return c.json({ error: "tags must be an array of strings" }, 400);
  }

  // Normalize: lowercase, trim, dedupe, filter empty
  const tags = [...new Set(body.tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean))];

  // Validate individual tags
  if (tags.length > MAX_TAGS_PER_SUMMARY) {
    return c.json({ error: `Maximum ${MAX_TAGS_PER_SUMMARY} tags per summary` }, 400);
  }
  for (const tag of tags) {
    if (tag.length > TAG_MAX_LENGTH) {
      return c.json({ error: `Tag "${tag}" exceeds ${TAG_MAX_LENGTH} characters` }, 400);
    }
  }

  // Check free user unique tag limit
  const plan = await getUserPlan(userId);
  if (plan === "free") {
    // Get all existing unique tags for this user (excluding the current summary)
    const { data: rows } = await supabase
      .from("summaries")
      .select("tags")
      .eq("user_id", userId)
      .neq("id", id)
      .is("deleted_at", null);

    const existingTags = new Set<string>();
    for (const row of rows ?? []) {
      for (const tag of (row.tags as string[]) ?? []) {
        existingTags.add(tag);
      }
    }

    // Count how many new unique tags this would introduce
    const newUnique = tags.filter((t) => !existingTags.has(t));
    const totalUnique = existingTags.size + newUnique.length;

    if (totalUnique > MAX_FREE_UNIQUE_TAGS) {
      return c.json(
        {
          error: `Free plan is limited to ${MAX_FREE_UNIQUE_TAGS} unique tags. Upgrade to Pro for unlimited tags.`,
          code: "TAG_LIMIT",
          limit: MAX_FREE_UNIQUE_TAGS,
          plan: "free",
        },
        403,
      );
    }
  }

  // Update the summary's tags
  const { data, error } = await supabase
    .from("summaries")
    .update({ tags })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("tags")
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ tags: (data.tags as string[]) ?? [] });
});

// ── GET / — Paginated list of user's summaries ───────────────

summaryRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = clampLimit(c.req.query("limit"));
  const offset = parseOffset(c.req.query("offset"));
  const statusFilter = c.req.query("status") ?? "completed";
  const tagFilter = c.req.query("tag");
  const plan = await getUserPlan(userId);

  let query = supabase
    .from("summaries")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", statusFilter)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Tag filter
  if (tagFilter) {
    query = query.contains("tags", [tagFilter]);
  }

  // Free users: restrict to last 7 days
  if (plan === "free") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FREE_HISTORY_DAYS);
    query = query.gte("created_at", cutoff.toISOString());
  }

  const { data, count, error } = await query;

  if (error) {
    return c.json({ error: "Failed to fetch summaries" }, 500);
  }

  return c.json({
    summaries: (data ?? []).map((r) => toSummary(r as Record<string, unknown>)),
    total: count ?? 0,
    offset,
    limit,
  });
});

// ── GET /:id — Full summary detail ──────────────────────────

summaryRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("summaries")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ summary: toSummary(data as Record<string, unknown>) });
});

// ── DELETE /:id — Soft-delete a summary ─────────────────────

summaryRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("summaries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ deleted: true, id: data.id });
});
