import { Hono } from "hono";
import { normalizeKeywords, type TabInput } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { supabase } from "../lib/supabase.js";
import { MAX_TABS, organizeTabs } from "../services/tab-organizer.js";
import { rankTags } from "../services/tagger.js";

const ORGANIZE_LIMIT_PER_HOUR = 60;
const MAX_KEY = 64;
const MAX_URL = 2048;
const MAX_TITLE = 300;
const MAX_TEXT = 2000;
const MAX_DESCRIPTION = 500;
const MAX_HINTS = 500;
const MAX_TAG = 30;

export const tabsRoutes = new Hono<AppEnv>();
tabsRoutes.use("*", authMiddleware);

/** Validate + clamp one tab from the request body; null if unusable. */
function parseTab(raw: unknown): TabInput | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.key !== "string" || !t.key || t.key.length > MAX_KEY) return null;
  if (typeof t.url !== "string" || t.url.length > MAX_URL || !/^https?:\/\//.test(t.url))
    return null;
  if (typeof t.title !== "string") return null;
  return {
    key: t.key,
    url: t.url,
    title: t.title.slice(0, MAX_TITLE),
    ...(typeof t.description === "string" && {
      description: t.description.slice(0, MAX_DESCRIPTION),
    }),
    ...(typeof t.text === "string" && { text: t.text.slice(0, MAX_TEXT) }),
    ...(typeof t.scrolledToEnd === "boolean" && { scrolledToEnd: t.scrolledToEnd }),
  };
}

/** User's contexts: clip tags (most-used first) then hint-only tags; plus hints by tag. */
async function loadTagsAndHints(userId: string) {
  const [{ data: rows }, { data: hintRows }] = await Promise.all([
    supabase.from("clips").select("tags").eq("user_id", userId).is("deleted_at", null),
    supabase.from("tag_hints").select("tag, hints, keywords").eq("user_id", userId),
  ]);
  const { hints, keywords } = hintMaps(hintRows ?? []);
  const ranked = rankTags(rows ?? []);
  const tags = [
    ...ranked,
    ...Object.keys(hints)
      .filter((t) => !ranked.includes(t))
      .sort(),
  ];
  return { tags, hints, keywords };
}

function hintMaps(rows: Record<string, unknown>[]) {
  const hints: Record<string, string> = {};
  const keywords: Record<string, string[]> = {};
  for (const r of rows) {
    const tag = r.tag as string;
    hints[tag] = (r.hints as string) ?? "";
    const kws = (r.keywords as string[] | null) ?? [];
    if (kws.length) keywords[tag] = kws;
  }
  return { hints, keywords };
}

// ── POST /organize — group open tabs into the user's contexts ──

tabsRoutes.post("/organize", async (c) => {
  const userId = c.get("userId");

  let body: { tabs?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.tabs) || body.tabs.length === 0 || body.tabs.length > MAX_TABS) {
    return c.json({ error: `tabs must be a non-empty array (max ${MAX_TABS})` }, 400);
  }
  const tabs = body.tabs.map(parseTab).filter((t): t is TabInput => t !== null);
  if (tabs.length === 0) return c.json({ error: "No valid tabs" }, 400);

  if (!checkRateLimit(`tabs-organize:${userId}`, ORGANIZE_LIMIT_PER_HOUR, 60 * 60_000)) {
    return c.json({ error: "Too many organize requests", code: "RATE_LIMITED" }, 429);
  }

  const { tags, hints, keywords } = await loadTagsAndHints(userId);
  return c.json(await organizeTabs({ tabs, existingTags: tags, hints, keywords }));
});

// ── GET /hints — per-tag hints + keywords ────────────────────

tabsRoutes.get("/hints", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("tag_hints")
    .select("tag, hints, keywords")
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to fetch hints" }, 500);
  return c.json(hintMaps(data ?? []));
});

// ── PUT /hints/:tag — upsert hints/keywords ──────────────────
// Body: { hints: string, keywords?: string[], keep?: boolean }. Omitted keywords
// are left as they are. The row is deleted only when hints and keywords both end
// up empty — unless keep, which registers a tag that has no clips yet
// ("＋ Save as tag" on a proposed group).

tabsRoutes.put("/hints/:tag", async (c) => {
  const userId = c.get("userId");
  const tag = decodeURIComponent(c.req.param("tag")).toLowerCase().trim();
  if (!tag || tag.length > MAX_TAG) return c.json({ error: "Invalid tag" }, 400);

  let body: { hints?: unknown; keywords?: unknown; keep?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.hints !== "string" || body.hints.length > MAX_HINTS) {
    return c.json({ error: `hints must be a string (max ${MAX_HINTS})` }, 400);
  }
  if (body.keywords !== undefined && !Array.isArray(body.keywords)) {
    return c.json({ error: "keywords must be an array of strings" }, 400);
  }
  const hints = body.hints.trim();
  const keywords = Array.isArray(body.keywords) ? normalizeKeywords(body.keywords) : undefined;

  let resultingKeywords = keywords;
  if (resultingKeywords === undefined) {
    const { data: existing } = await supabase
      .from("tag_hints")
      .select("keywords")
      .eq("user_id", userId)
      .eq("tag", tag)
      .maybeSingle();
    resultingKeywords = (existing?.keywords as string[] | null) ?? [];
  }

  if (!hints && resultingKeywords.length === 0 && body.keep !== true) {
    const { error } = await supabase
      .from("tag_hints")
      .delete()
      .eq("user_id", userId)
      .eq("tag", tag);
    if (error) return c.json({ error: "Failed to save hints" }, 500);
    return c.json({ tag, hints: "", keywords: [] });
  }

  const { error } = await supabase.from("tag_hints").upsert(
    {
      user_id: userId,
      tag,
      hints,
      ...(keywords !== undefined && { keywords }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,tag" },
  );
  if (error) return c.json({ error: "Failed to save hints" }, 500);
  return c.json({ tag, hints, keywords: resultingKeywords });
});
