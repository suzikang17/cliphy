import { Hono } from "hono";
import {
  normalizeKeywords,
  type ClosedGroupPage,
  type TabAssignment,
  type TabCluster,
  type TabInput,
} from "@cliphy/shared";
import {
  loadPageTags,
  pageKey,
  promoteProposal,
  reusableAssignment,
  saveAiAssignments,
  setOverrides,
} from "../services/page-tags.js";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { supabase } from "../lib/supabase.js";
import { MAX_TABS, organizeTabs } from "../services/tab-organizer.js";
import { rankTags } from "../services/tagger.js";
import {
  MAX_CLOSED_PAGES,
  closeGroup,
  listClosedGroups,
  resumeGroup,
} from "../services/closed-groups.js";

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

const MAX_CLUSTERS = 20;

/** Validate the extension's "worked on together" clusters; keep only known tab keys. */
function parseClusters(raw: unknown, keys: Set<string>): TabCluster[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return raw
    .slice(0, MAX_CLUSTERS)
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      keys: Array.isArray(c.keys)
        ? [...new Set(c.keys.filter((k): k is string => typeof k === "string" && keys.has(k)))]
        : [],
      start: num(c.start),
      end: num(c.end),
      switches: Math.max(0, Math.floor(num(c.switches))),
      openerLinks: Math.max(0, Math.floor(num(c.openerLinks))),
    }))
    .filter((c) => c.keys.length >= 2 && c.end >= c.start);
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

  let body: { tabs?: unknown; clusters?: unknown };
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

  // Pages already sorted (on any device) are answered from page_tags; AI runs only on new ones.
  const stored = await loadPageTags(
    userId,
    tabs.map((t) => t.url),
  );
  const now = Date.now();
  const assignments: Record<string, TabAssignment> = {};
  const done: string[] = [];
  const overrides: Record<string, string> = {};
  const fresh: TabInput[] = [];
  for (const tab of tabs) {
    const row = stored.get(pageKey(tab.url));
    if (row?.override) overrides[tab.key] = row.override;
    const reuse = row ? reusableAssignment(row, now) : null;
    if (reuse && row) {
      assignments[tab.key] = reuse;
      if (row.done) done.push(tab.key);
    } else {
      fresh.push(tab);
    }
  }

  let proposalKeywords: Record<string, string[]> = {};
  let proposalReasons: Record<string, string> = {};
  if (fresh.length > 0) {
    const { tags, hints, keywords } = await loadTagsAndHints(userId);
    const clusters = parseClusters(body.clusters, new Set(tabs.map((t) => t.key)));
    const r = await organizeTabs({ tabs: fresh, existingTags: tags, hints, keywords, clusters });
    Object.assign(assignments, r.assignments);
    done.push(...r.done);
    proposalKeywords = r.proposalKeywords ?? {};
    proposalReasons = r.proposalReasons ?? {};
    // Persist answers that actually came from somewhere (a failed AI call isn't an answer).
    const doneSet = new Set(r.done);
    await saveAiAssignments(
      userId,
      fresh
        .filter((t) => r.sources[t.key])
        .map((t) => ({
          url: t.url,
          assignment: r.assignments[t.key],
          source: r.sources[t.key],
          done: doneSet.has(t.key),
        })),
    );
  }
  return c.json({ assignments, done, proposalKeywords, proposalReasons, overrides });
});

// ── PUT /overrides — your manual group choices for pages ─────
// Body: { items: [{ url, override: "tag:x" | "site:host" | "proposed:x" | null }] }

const MAX_OVERRIDES = 100;

tabsRoutes.put("/overrides", async (c) => {
  const userId = c.get("userId");
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_OVERRIDES) {
    return c.json({ error: `items must be a non-empty array (max ${MAX_OVERRIDES})` }, 400);
  }
  const items = body.items
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .filter(
      (i) =>
        typeof i.url === "string" &&
        /^https?:\/\//.test(i.url) &&
        (i.override === null ||
          (typeof i.override === "string" && /^(tag|site|proposed):.{1,120}$/.test(i.override))),
    )
    .map((i) => ({ url: i.url as string, override: i.override as string | null }));
  if (items.length === 0) return c.json({ error: "No valid items" }, 400);
  try {
    await setOverrides(userId, items);
  } catch {
    return c.json({ error: "Failed to save overrides" }, 500);
  }
  return c.json({ saved: items.length });
});

// ── Closed groups — close a whole group, list, resume ────────
// Registered BEFORE /hints/:tag-style routes; "/groups/…" never collides.

const MAX_LABEL = 120;

tabsRoutes.get("/groups/closed", async (c) => {
  try {
    return c.json({ groups: await listClosedGroups(c.get("userId")) });
  } catch {
    return c.json({ error: "Failed to load closed groups" }, 500);
  }
});

tabsRoutes.put("/groups/:key/close", async (c) => {
  const userId = c.get("userId");
  const key = decodeURIComponent(c.req.param("key"));
  let body: { label?: unknown; pages?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.label !== "string" || !body.label.trim()) {
    return c.json({ error: "label is required" }, 400);
  }
  if (
    !Array.isArray(body.pages) ||
    body.pages.length === 0 ||
    body.pages.length > MAX_CLOSED_PAGES
  ) {
    return c.json({ error: `pages must be a non-empty array (max ${MAX_CLOSED_PAGES})` }, 400);
  }
  const pages: ClosedGroupPage[] = body.pages
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .filter((p) => typeof p.url === "string" && /^https?:\/\//.test(p.url))
    .map((p) => ({
      url: (p.url as string).slice(0, 2048),
      title: typeof p.title === "string" ? p.title.slice(0, 300) : "",
    }));
  if (pages.length === 0) return c.json({ error: "No valid pages" }, 400);
  try {
    return c.json(await closeGroup(userId, key, body.label.trim().slice(0, MAX_LABEL), pages));
  } catch {
    return c.json({ error: "Failed to save closed group" }, 500);
  }
});

tabsRoutes.post("/groups/:key/resume", async (c) => {
  const g = await resumeGroup(c.get("userId"), decodeURIComponent(c.req.param("key")));
  return g ? c.json({ pages: g.pages }) : c.json({ error: "Not found" }, 404);
});

// ── Group notes — your note per tag group ────────────────────
const MAX_NOTE = 4000;

tabsRoutes.get("/notes", async (c) => {
  const { data, error } = await supabase
    .from("tag_notes")
    .select("tag, note")
    .eq("user_id", c.get("userId"));
  if (error) return c.json({ error: "Failed to fetch notes" }, 500);
  const notes: Record<string, string> = {};
  for (const r of data ?? []) notes[r.tag as string] = r.note as string;
  return c.json({ notes });
});

// Body: { note: string }. An empty note deletes it.
tabsRoutes.put("/notes/:tag", async (c) => {
  const userId = c.get("userId");
  const tag = c.req.param("tag").toLowerCase().trim(); // Hono already decoded it
  if (!tag || tag.length > MAX_TAG) return c.json({ error: "Invalid tag" }, 400);
  let body: { note?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.note !== "string" || body.note.length > MAX_NOTE) {
    return c.json({ error: `note must be a string (max ${MAX_NOTE})` }, 400);
  }
  const note = body.note.trim();
  if (!note) {
    const { error } = await supabase
      .from("tag_notes")
      .delete()
      .eq("user_id", userId)
      .eq("tag", tag);
    if (error) return c.json({ error: "Failed to save note" }, 500);
    return c.json({ tag, note: "" });
  }
  const { error } = await supabase
    .from("tag_notes")
    .upsert(
      { user_id: userId, tag, note, updated_at: new Date().toISOString() },
      { onConflict: "user_id,tag" },
    );
  if (error) return c.json({ error: "Failed to save note" }, 500);
  return c.json({ tag, note });
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

  let body: { hints?: unknown; keywords?: unknown; keep?: unknown; fromProposal?: unknown };
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
  // "＋ Save as tag": pages the AI proposed under that name now carry the tag — on every device.
  if (typeof body.fromProposal === "string" && body.fromProposal.trim()) {
    await promoteProposal(userId, body.fromProposal.trim().toLowerCase(), tag);
  }
  return c.json({ tag, hints, keywords: resultingKeywords });
});
