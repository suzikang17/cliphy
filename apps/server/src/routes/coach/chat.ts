import { Hono } from "hono";
import type { ChatButton } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { inngest } from "../../lib/inngest.js";
import { signImageUrl } from "../../lib/storage.js";
import { executeAction, FAILED, type ActionResult } from "../../services/coach/actions.js";
import { loadActivity } from "../../services/coach/activity.js";
import { didAction } from "../../services/coach/botMessages.js";
import {
  listMessages,
  postBotMessage,
  postUserMessage,
  toChatMessage,
} from "../../services/coach/chat.js";

export const chatRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

const MAX_TEXT = 4000;

// ── GET / — the thread ───────────────────────────────────────────────────

chatRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit"));
  const [messages, activity] = await Promise.all([
    listMessages(userId, {
      after: c.req.query("after"),
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    }),
    // What the bot is doing right now, for the quiet status line under the thread.
    loadActivity(userId),
  ]);
  // Attachments are stored as paths; the phone needs a short-lived link to show them.
  for (const m of messages) {
    for (const a of m.attachments) a.url = (await signImageUrl(a.storagePath)) ?? undefined;
  }
  return c.json({ messages, activity });
});

// ── POST / — the user types something; the bot answers in the background ─

chatRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return c.json({ error: "text is required" }, 400);

  const messageId = await postUserMessage(userId, text);
  if (!messageId) return c.json({ error: "Failed to save message" }, 500);
  await inngest.send({ name: "coach/chat.message", data: { userId, messageId } });
  return c.json({ messageId }, 202);
});

// ── POST /:id/choose — tap a button ──────────────────────────────────────

chatRoutes.post("/:id/choose", async (c) => {
  // A tap is the owner's, on the phone. A button can confirm a request or start
  // work on a website, and no API key may do either.
  if (c.get("authMethod") === "api_key") {
    return c.json({ error: "Sign in on the phone to do this" }, 403);
  }
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{ index?: unknown }>().catch(() => ({}) as { index?: unknown });

  const { data: found } = await supabase
    .from("coach_chat_messages")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  const row = found as Row | null;
  if (!row) return c.json({ error: "message not found" }, 404);

  const buttons = (row.buttons as ChatButton[]) ?? [];
  const index = body.index;
  if (typeof index !== "number" || !Number.isInteger(index) || !buttons[index]) {
    return c.json({ error: "no such button" }, 400);
  }

  // Claim the tap first, guarded on "not tapped yet", so a double tap acts once.
  const { data: claimed } = await supabase
    .from("coach_chat_messages")
    .update({ chosen: index })
    .eq("id", id)
    .eq("user_id", userId)
    .is("chosen", null)
    .select("*")
    .maybeSingle();
  if (!claimed) return c.json({ message: toChatMessage(row), did: null });

  let result: ActionResult;
  try {
    result = await executeAction(userId, buttons[index].action);
  } catch {
    result = FAILED;
  }

  let message = toChatMessage(claimed as Row);
  if (result.release) {
    // Nothing was done (or only a question was asked): give the button back.
    await supabase
      .from("coach_chat_messages")
      .update({ chosen: null })
      .eq("id", id)
      .eq("user_id", userId);
    message = { ...message, chosen: null };
  }
  // Whatever the bot did, or could not do, it says so.
  if (result.say) {
    await postBotMessage(userId, didAction(result.say, result.buttons, result.links));
  }

  return c.json({ message, did: result.say });
});
