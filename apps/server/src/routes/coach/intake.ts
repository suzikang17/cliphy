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

// ── POST /messages — captured messages, grouped into bundles ─────────────

interface IncomingMessage {
  externalId: string;
  direction: Direction;
  text: string;
  sentAt: string;
  attachments: { storagePath: string; mediaType: string }[];
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
      attachments.push({ storagePath: a.storagePath, mediaType: a.mediaType });
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
  for (const bundleId of touched) {
    await inngest.send({ name: "coach/bundle.touched", data: { bundleId, userId } });
  }

  return c.json({ stored, duplicates, bundleIds: touched });
});
