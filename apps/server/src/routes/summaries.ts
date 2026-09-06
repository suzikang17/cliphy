import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { sanitizeSearchQuery } from "../lib/validation.js";
import {
  FREE_HISTORY_DAYS,
  MAX_NOTES_LENGTH,
  MAX_TAGS_PER_SUMMARY,
  MAX_FREE_UNIQUE_TAGS,
  TAG_MAX_LENGTH,
  PRO_FEATURES,
  PLAN_LIMITS,
  SUMMARY_LANGUAGES,
} from "@cliphy/shared";
import type { SummaryJson, ChatMessage, SummaryLanguageCode } from "@cliphy/shared";
import { toSummary } from "../lib/mappers.js";
import { resolveClipImage } from "../lib/storage.js";
import { semanticSearch } from "../services/search.js";
import { suggestTags, suggestTagsBulk } from "../services/auto-tag.js";
import { requirePro } from "../middleware/require-pro.js";
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { chatWithVideo } from "../services/chat.js";
import { translateSummaryJson } from "../services/translator.js";

export const summaryRoutes = new Hono<AppEnv>();

// Apply auth to all summary routes
summaryRoutes.use("*", authMiddleware);

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

  // Semantic first; fall back to ILIKE on any failure or empty result.
  try {
    const semantic = await semanticSearch(userId, q, limit);
    if (semantic.length > 0) {
      return c.json({ summaries: semantic, total: semantic.length, offset, limit });
    }
  } catch {
    // fall through to keyword search
  }

  // Build the base query — only completed, non-deleted, owned by user
  let query = supabase
    .from("clips")
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
    summaries: await Promise.all(
      (data ?? []).map((r) => resolveClipImage(toSummary(r as Record<string, unknown>))),
    ),
    total: count ?? 0,
    offset,
    limit,
  });
});

// ── GET /tags — List user's unique tags ───────────────────────

summaryRoutes.get("/tags", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("clips")
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

// ── POST /auto-tag/bulk — Bulk auto-tag (Pro only) ───────────
// Registered BEFORE /:id so "auto-tag" isn't captured as an :id param.

summaryRoutes.post("/auto-tag/bulk", requirePro(PRO_FEATURES.AUTO_TAG), async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ summaryIds?: unknown }>();

  if (
    !Array.isArray(body.summaryIds) ||
    body.summaryIds.length === 0 ||
    body.summaryIds.length > 20
  ) {
    return c.json({ error: "summaryIds must be a non-empty array (max 20)" }, 400);
  }

  const ids = body.summaryIds.filter((id): id is string => typeof id === "string");

  // Fetch summaries owned by user
  const { data: rows } = await supabase
    .from("clips")
    .select("id, summary_json")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("id", ids);

  if (!rows || rows.length === 0) {
    return c.json({ suggestions: [] });
  }

  // Fetch existing tags
  const { data: allRows } = await supabase
    .from("clips")
    .select("tags")
    .eq("user_id", userId)
    .is("deleted_at", null);

  const existingTags = [
    ...new Set((allRows ?? []).flatMap((r) => (r.tags as string[]) ?? [])),
  ].sort();

  // Split into taggable and skipped
  const taggable = rows.filter((r) => r.summary_json);
  const skippedIds = new Set(ids.filter((id) => !taggable.some((r) => r.id === id)));

  if (taggable.length === 0) {
    return c.json({
      suggestions: ids.map((id) => ({ summaryId: id, skipped: true })),
    });
  }

  const results = await suggestTagsBulk(
    taggable.map((r) => ({
      id: r.id,
      summaryJson: r.summary_json as SummaryJson,
    })),
    existingTags,
  );

  const suggestions = ids.map((id) => {
    if (skippedIds.has(id)) return { summaryId: id, skipped: true as const };
    const result = results.find((r) => r.id === id);
    return {
      summaryId: id,
      existing: result?.existing ?? [],
      new: result?.new ?? [],
    };
  });

  return c.json({ suggestions });
});

// ── POST /:id/auto-tag — Single summary auto-tag (Pro only) ──

summaryRoutes.post("/:id/auto-tag", requirePro(PRO_FEATURES.AUTO_TAG), async (c) => {
  const userId = c.get("userId");
  const summaryId = c.req.param("id");

  const { data: summary } = await supabase
    .from("clips")
    .select("id, summary_json")
    .eq("id", summaryId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (!summary) {
    return c.json({ error: "Summary not found" }, 404);
  }

  if (!summary.summary_json) {
    return c.json({ error: "Summary not ready for auto-tagging" }, 400);
  }

  // Fetch existing tags
  const { data: allRows } = await supabase
    .from("clips")
    .select("tags")
    .eq("user_id", userId)
    .is("deleted_at", null);

  const existingTags = [
    ...new Set((allRows ?? []).flatMap((r) => (r.tags as string[]) ?? [])),
  ].sort();

  const result = await suggestTags(summary.summary_json as SummaryJson, existingTags);

  return c.json(result);
});

// ── GET /:id/chat — Load chat history (Pro only) ─────────────

summaryRoutes.get("/:id/chat", requirePro(PRO_FEATURES.VIDEO_CHAT), async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("clips")
    .select("chat_messages")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ messages: data.chat_messages ?? [] });
});

// ── POST /:id/chat — Chat with a video (Pro only) ───────────

summaryRoutes.post("/:id/chat", requirePro(PRO_FEATURES.VIDEO_CHAT), async (c) => {
  const userId = c.get("userId");
  const summaryId = c.req.param("id");

  const body = await c.req.json<{ messages?: unknown }>();

  // Validate messages
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 50) {
    return c.json({ error: "messages must be a non-empty array (max 50)" }, 400);
  }

  for (const msg of body.messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      typeof msg.role !== "string" ||
      typeof msg.content !== "string"
    ) {
      return c.json({ error: "Each message must have a role and content" }, 400);
    }
  }

  // Fetch summary
  const { data: summary } = await supabase
    .from("clips")
    .select("*")
    .eq("id", summaryId)
    .eq("user_id", userId)
    .eq("status", "completed")
    .is("deleted_at", null)
    .single();

  if (!summary) {
    return c.json({ error: "Summary not found" }, 404);
  }

  if (!summary.transcript) {
    return c.json({ error: "No transcript available for this video", code: "NO_TRANSCRIPT" }, 400);
  }

  try {
    const result = await chatWithVideo({
      transcript: summary.transcript as string,
      videoTitle: summary.video_title as string,
      summaryJson: summary.summary_json as SummaryJson,
      messages: body.messages as ChatMessage[],
    });

    // Persist the updated conversation to the DB
    const updatedMessages = [
      ...(body.messages as ChatMessage[]),
      { role: "assistant" as const, content: result.content },
    ];

    await supabase.from("clips").update({ chat_messages: updatedMessages }).eq("id", summaryId);

    return c.json(result);
  } catch (err) {
    if (err instanceof APIConnectionError) {
      return c.json({ error: "AI service temporarily unavailable" }, 503);
    }
    if (err instanceof APIError) {
      if (err.status === 429 || err.status === 500 || err.status === 503) {
        return c.json({ error: "AI service temporarily unavailable" }, 503);
      }
      if (err.status === 400 || err.status === 401) {
        return c.json({ error: "AI service error" }, 500);
      }
    }
    throw err;
  }
});

// ── PATCH /:id — Update summary content ─────────────────────

summaryRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const body = await c.req.json<{ summary_json?: unknown }>();

  // Validate summary_json structure
  const sj = body.summary_json;
  if (
    typeof sj !== "object" ||
    sj === null ||
    typeof (sj as Record<string, unknown>).summary !== "string" ||
    !Array.isArray((sj as Record<string, unknown>).keyPoints) ||
    !Array.isArray((sj as Record<string, unknown>).timestamps)
  ) {
    return c.json(
      {
        error: "summary_json must have summary (string), keyPoints (array), and timestamps (array)",
      },
      400,
    );
  }

  const { data, error } = await supabase
    .from("clips")
    .update({ summary_json: sj })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ summary: await resolveClipImage(toSummary(data as Record<string, unknown>)) });
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
      .from("clips")
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
    .from("clips")
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

// ── PATCH /:id/notes — Update user notes on a summary ────────

summaryRoutes.patch("/:id/notes", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const body = await c.req.json<{ notes: unknown }>();

  if (typeof body.notes !== "string") {
    return c.json({ error: "notes must be a string" }, 400);
  }
  if (body.notes.length > MAX_NOTES_LENGTH) {
    return c.json({ error: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer` }, 400);
  }

  // Empty string clears notes; store null so the column reads as "no notes".
  const notes = body.notes.length > 0 ? body.notes : null;

  const { data, error } = await supabase
    .from("clips")
    .update({ user_notes: notes })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ summary: await resolveClipImage(toSummary(data as Record<string, unknown>)) });
});

// ── POST /:id/archive — move a clip out of the inbox ──────────

summaryRoutes.post("/:id/archive", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, archived_at")
    .single();
  if (error || !data) return c.json({ error: "Failed to archive clip" }, 500);
  return c.json({ id: data.id, archivedAt: data.archived_at });
});

// ── POST /:id/unarchive — undo an archive ─────────────────────

summaryRoutes.post("/:id/unarchive", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, archived_at")
    .single();
  if (error || !data) return c.json({ error: "Failed to unarchive clip" }, 500);
  return c.json({ id: data.id, archivedAt: null });
});

// ── POST /:id/enrich — promote a bookmark to a full clip ──────

summaryRoutes.post("/:id/enrich", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ enrichment_tier: "full", status: "pending" })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .single();
  if (error || !data) return c.json({ error: "Failed to enrich clip" }, 500);
  await inngest.send({ name: "clip/embed.requested", data: { clipId: id } });
  return c.json({ ok: true });
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
    .from("clips")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", statusFilter)
    .is("deleted_at", null)
    // Metadata-tier clips are bookmarks (tiles), not things to triage. Deleting
    // the enrichment_tier filter below is the one-line way to change that
    // decision — see the pins & panels spec, "Why these shapes".
    .is("archived_at", null)
    .eq("enrichment_tier", "full")
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
    summaries: await Promise.all(
      (data ?? []).map((r) => resolveClipImage(toSummary(r as Record<string, unknown>))),
    ),
    total: count ?? 0,
    offset,
    limit,
  });
});

// ── POST /:id/translate — Translate an existing summary ───────
summaryRoutes.post("/:id/translate", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const body = await c.req.json<{ language?: string }>().catch(() => ({ language: undefined }));
  const lang = body.language as SummaryLanguageCode | undefined;

  if (!lang || !(lang in SUMMARY_LANGUAGES)) {
    return c.json({ error: "Invalid language code" }, 400);
  }

  const { data: summary } = await supabase
    .from("clips")
    .select("summary_json, summary_language, translations")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "completed")
    .is("deleted_at", null)
    .single();

  if (!summary) return c.json({ error: "Summary not found" }, 404);
  if (!summary.summary_json) return c.json({ error: "Summary not ready" }, 400);

  const originalLang = (summary.summary_language as string) ?? "en";

  // Requesting the original language — return as-is, free
  if (lang === originalLang) {
    return c.json({ summaryJson: summary.summary_json, cached: true });
  }

  // Already translated — return cached, free
  const cached = (summary.translations as Record<string, unknown> | null)?.[lang];
  if (cached) {
    return c.json({ summaryJson: cached, cached: true });
  }

  // New translation — costs one usage credit
  const { data: user } = await supabase
    .from("users")
    .select("plan, monthly_limit_bonus")
    .eq("id", userId)
    .single();
  const plan = (user?.plan as "free" | "pro") ?? "free";
  const limit = PLAN_LIMITS[plan] + ((user?.monthly_limit_bonus as number) ?? 0);

  const { data: allowed } = await supabase.rpc("increment_monthly_count", {
    p_user_id: userId,
    p_limit: limit,
  });

  if (!allowed) {
    return c.json(
      { error: "Monthly summary limit reached", code: "RATE_LIMITED", limit, plan },
      429,
    );
  }

  try {
    const targetLangName = SUMMARY_LANGUAGES[lang];
    const translated = await translateSummaryJson(
      summary.summary_json as import("@cliphy/shared").SummaryJson,
      targetLangName,
    );

    // Merge into translations JSONB
    const existing = (summary.translations as Record<string, unknown>) ?? {};
    await supabase
      .from("clips")
      .update({ translations: { ...existing, [lang]: translated } })
      .eq("id", id);

    return c.json({ summaryJson: translated, cached: false });
  } catch (err) {
    await supabase.rpc("decrement_monthly_count", { p_user_id: userId });
    throw err;
  }
});

// ── GET /:id — Full summary detail ──────────────────────────

summaryRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("clips")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return c.json({ error: "Summary not found" }, 404);
  }

  return c.json({ summary: await resolveClipImage(toSummary(data as Record<string, unknown>)) });
});

// ── DELETE /:id — Soft-delete a summary ─────────────────────

summaryRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("clips")
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
