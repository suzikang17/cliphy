import { Hono } from "hono";
import type { ChatButton } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { inngest } from "../../lib/inngest.js";
import { executeAction } from "../../services/coach/actions.js";
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
  const limit = Number(c.req.query("limit"));
  const messages = await listMessages(c.get("userId"), {
    after: c.req.query("after"),
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
  });
  return c.json({ messages });
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

  const result = await executeAction(userId, buttons[index].action);
  // Whatever the bot did, it says so.
  if (result.say) await postBotMessage(userId, didAction(result.say));

  return c.json({ message: toChatMessage(claimed as Row), did: result.say });
});
