import { noteOutgoing } from "../../services/coach/batches.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { CHANNELS, type Channel, type Direction } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { inngest } from "../../lib/inngest.js";
import { pickBundle, type OpenBundle } from "../../services/coach/bundling.js";

export const intakeRoutes = new Hono<AppEnv>();

const BUCKET = "clip-images";
const MAX_MESSAGES = 200;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// ── POST /upload-url — where the capturer puts an attachment's bytes ─────

/** A place in a text: a whole number of characters from its start. */
const isPlace = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

intakeRoutes.post("/upload-url", async (c) => {
  const userId = c.get("userId");
  const { mediaType } = await c.req.json<{ mediaType?: string }>();
  const ext = mediaType ? EXTENSIONS[mediaType] : undefined;
  if (!ext) return c.json({ error: "unsupported media type" }, 400);

  const path = `coach/${userId}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return c.json({ error: "Failed to create upload url" }, 500);
  return c.json({ path, signedUrl: data.signedUrl, token: data.token });
});

// ── POST /heartbeat — the capturer is alive ──────────────────────────────

intakeRoutes.post("/heartbeat", async (c) => {
  await supabase
    .from("coach_settings")
    .upsert(
      { user_id: c.get("userId"), helper_seen_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  return c.json({ ok: true });
});

// ── POST /messages — captured messages, grouped into bundles ─────────────

interface IncomingMessage {
  externalId: string;
  direction: Direction;
  text: string;
  sentAt: string;
  attachments: { storagePath: string; mediaType: string; at?: number }[];
}

/** Validate and normalise the batch. Returns an error message, or the messages in time order. */
function parseMessages(raw: unknown, userId: string): string | IncomingMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) return "messages is required";
  if (raw.length > MAX_MESSAGES) return "too many messages";

  const out: IncomingMessage[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    if (typeof m?.externalId !== "string" || !m.externalId) return "externalId is required";
    if (m.direction !== "in" && m.direction !== "out") return "direction must be in or out";
    const time = typeof m.sentAt === "string" ? Date.parse(m.sentAt) : NaN;
    if (Number.isNaN(time)) return "sentAt must be a date";

    const attachments: IncomingMessage["attachments"] = [];
    for (const a of (Array.isArray(m.attachments) ? m.attachments : []) as Record<
      string,
      unknown
    >[]) {
      if (
        typeof a?.storagePath !== "string" ||
        !a.storagePath.startsWith(`coach/${userId}/`) ||
        a.storagePath.split("/").includes("..")
      ) {
        return "invalid attachment path";
      }
      if (typeof a.mediaType !== "string" || !(a.mediaType in EXTENSIONS)) {
        return "unsupported attachment type";
      }
      attachments.push({
        storagePath: a.storagePath,
        mediaType: a.mediaType,
        // Where in the text the picture sat. Anything but a whole number from zero up is dropped.
        ...(isPlace(a.at) ? { at: a.at } : {}),
      });
    }

    out.push({
      externalId: m.externalId,
      direction: m.direction,
      text: typeof m.text === "string" ? m.text : "",
      sentAt: new Date(time).toISOString(),
      attachments,
    });
  }
  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

// ── POST /layout — where pictures sit in messages already stored ─────────
// Messages uploaded before places were kept have none. The capturer sends
// them once: per message, one place per stored picture, in order.

const MAX_LAYOUT_ITEMS = 500;

intakeRoutes.post("/layout", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ personId?: unknown; items?: unknown }>()
    .catch(() => ({}) as { personId?: unknown; items?: unknown });
  if (typeof body.personId !== "string") return c.json({ error: "personId is required" }, 400);
  if (!Array.isArray(body.items) || body.items.length > MAX_LAYOUT_ITEMS) {
    return c.json({ error: "items must be a list" }, 400);
  }
  const places = new Map<string, number[]>();
  for (const item of body.items as Record<string, unknown>[]) {
    if (
      typeof item?.externalId !== "string" ||
      !Array.isArray(item.at) ||
      !item.at.every(isPlace)
    ) {
      return c.json({ error: "each item needs an externalId and a list of places" }, 400);
    }
    places.set(item.externalId, item.at as number[]);
  }

  const { data: person } = await supabase
    .from("coach_people")
    .select("id")
    .eq("id", body.personId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!person) return c.json({ error: "person not found" }, 404);
  if (places.size === 0) return c.json({ updated: 0 });

  const { data } = await supabase
    .from("coach_messages")
    .select("id, external_id, attachments")
    .eq("user_id", userId)
    .eq("person_id", body.personId)
    .in("external_id", [...places.keys()]);

  let updated = 0;
  for (const row of (data as {
    id: string;
    external_id: string;
    attachments: Record<string, unknown>[] | null;
  }[]) ?? []) {
    const at = places.get(row.external_id);
    const pictures = row.attachments ?? [];
    // Only when the pictures line up one for one; a guess would misplace them.
    if (!at || at.length !== pictures.length || pictures.length === 0) continue;
    const { error } = await supabase
      .from("coach_messages")
      .update({ attachments: pictures.map((picture, i) => ({ ...picture, at: at[i] })) })
      .eq("id", row.id)
      .eq("user_id", userId);
    if (!error) updated++;
  }
  return c.json({ updated });
});

intakeRoutes.post("/messages", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    personId?: string;
    channel?: string;
    historical?: boolean;
    messages?: unknown;
  }>();

  if (typeof body.personId !== "string") return c.json({ error: "personId is required" }, 400);
  if (!CHANNELS.includes(body.channel as Channel)) {
    return c.json({ error: "channel must be imessage, sms or share" }, 400);
  }
  const channel = body.channel as Channel;
  const messages = parseMessages(body.messages, userId);
  if (typeof messages === "string") return c.json({ error: messages }, 400);

  const { data: person } = await supabase
    .from("coach_people")
    .select("id")
    .eq("id", body.personId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!person) return c.json({ error: "person not found" }, 404);

  // Re-uploads are expected (the capturer retries), so drop what is already stored.
  const { data: existingRows } = await supabase
    .from("coach_messages")
    .select("external_id, bundle_id")
    .eq("user_id", userId)
    .eq("channel", channel)
    .in(
      "external_id",
      messages.map((m) => m.externalId),
    );
  const alreadyStored = (existingRows as { external_id: string; bundle_id: string | null }[]) ?? [];
  const existing = new Set(alreadyStored.map((r) => r.external_id));
  const fresh = messages.filter((m) => !existing.has(m.externalId));
  let duplicates = messages.length - fresh.length;

  // A retry usually means the first upload died part-way. If it stored the
  // messages but never announced their bundle, nothing would ever read it, so
  // announce any of those bundles that is still waiting. The job is debounced
  // and skips finished bundles, so announcing twice is harmless.
  const seenBundleIds = [
    ...new Set(alreadyStored.map((r) => r.bundle_id).filter(Boolean)),
  ] as string[];
  if (seenBundleIds.length > 0) {
    const { data: waiting } = await supabase
      .from("coach_bundles")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "collecting")
      .in("id", seenBundleIds);
    for (const b of (waiting as { id: string }[]) ?? []) {
      await inngest.send({ name: "coach/bundle.touched", data: { bundleId: b.id, userId } });
    }
  }
  if (fresh.length === 0) return c.json({ stored: 0, duplicates, bundleIds: [] });

  const { data: latest } = await supabase
    .from("coach_bundles")
    .select("id, status, last_message_at, historical")
    .eq("user_id", userId)
    .eq("person_id", body.personId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let current: OpenBundle | null = latest
    ? {
        id: (latest as { id: string }).id,
        status: (latest as { status: OpenBundle["status"] }).status,
        lastMessageAt: (latest as { last_message_at: string }).last_message_at,
        historical: (latest as { historical?: boolean }).historical === true,
      }
    : null;

  const historical = body.historical === true;
  let stored = 0;
  const touched: string[] = [];
  const moved = new Map<string, string>(); // bundle id → its new last message time

  for (const m of fresh) {
    const decision = pickBundle(current, m.direction, m.sentAt, undefined, historical);
    let bundleId: string | null = null;

    if (decision === "new") {
      const { data: created, error } = await supabase
        .from("coach_bundles")
        .insert({
          user_id: userId,
          person_id: body.personId,
          last_message_at: m.sentAt,
          historical,
        })
        .select("id, status, last_message_at")
        .single();
      if (error || !created) return c.json({ error: "Failed to store messages" }, 500);
      current = {
        id: (created as { id: string }).id,
        status: "collecting",
        lastMessageAt: m.sentAt,
        historical,
      };
      bundleId = current.id;
    } else if (decision === "append" && current) {
      bundleId = current.id;
      if (m.sentAt > current.lastMessageAt) {
        current = { ...current, lastMessageAt: m.sentAt };
        moved.set(current.id, m.sentAt);
      }
    }

    const { data: inserted, error } = await supabase
      .from("coach_messages")
      .upsert(
        {
          user_id: userId,
          person_id: body.personId,
          bundle_id: bundleId,
          channel,
          direction: m.direction,
          external_id: m.externalId,
          text: m.text,
          attachments: m.attachments,
          sent_at: m.sentAt,
        },
        { onConflict: "user_id,channel,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) return c.json({ error: "Failed to store messages" }, 500);
    // An empty result means another upload stored this message first.
    if (((inserted as unknown[]) ?? []).length === 0) {
      duplicates++;
      continue;
    }
    stored++;
    if (bundleId && !touched.includes(bundleId)) touched.push(bundleId);
  }

  for (const [bundleId, lastMessageAt] of moved) {
    await supabase
      .from("coach_bundles")
      .update({ last_message_at: lastMessageAt })
      .eq("id", bundleId)
      .eq("user_id", userId);
  }
  // A summary the owner sent herself closes the batch it reports.
  const sentTexts = fresh.filter((m) => m.direction === "out" && m.text.trim()).map((m) => m.text);
  if (sentTexts.length > 0 && !historical) {
    try {
      await noteOutgoing(userId, body.personId, sentTexts);
    } catch {
      // The messages are stored; the batch can still be marked sent by hand.
    }
  }

  for (const bundleId of touched) {
    // `historical` lets the job read history cheaply and after live bundles.
    await inngest.send({ name: "coach/bundle.touched", data: { bundleId, userId, historical } });
  }

  return c.json({ stored, duplicates, bundleIds: touched });
});
