import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { learnFromAnswer, runAgent } from "../services/coach/agent.js";
import { postBotMessage } from "../services/coach/chat.js";

type Step = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

/** Tell the user their message was not answered. Keyed on the message, so it is said once. */
export async function replyFailed(userId: string, messageId: string): Promise<void> {
  await postBotMessage(userId, {
    text: "That didn't go through. Try again.",
    buttons: [],
    link: null,
    attachments: [],
    kind: "answer",
    refId: messageId,
  });
}

/** One message at a time per user, so replies come back in the order things were said. */
export const CHAT_JOB = {
  id: "coach-chat-reply",
  retries: 1,
  concurrency: [{ key: "event.data.userId", limit: 1 }],
  triggers: [{ event: "coach/chat.message" }],
  onFailure: async ({ event }: { event: { data: { event: { data: unknown } } } }) => {
    const { userId, messageId } = event.data.event.data as { userId: string; messageId: string };
    await replyFailed(userId, messageId);
  },
} as const;

/**
 * The user typed something. Run the agent on it and post its reply.
 * The reply is keyed on the user's message, so a retry cannot answer twice.
 */
export const chatReply = inngest.createFunction(
  CHAT_JOB as never,
  (async ({ event, step }: { event: { data: unknown }; step: Step }) => {
    const { userId, messageId } = event.data as { userId: string; messageId: string };

    const text = await step.run("load", async () => {
      const { data } = await supabase
        .from("coach_chat_messages")
        .select("id, role, text")
        .eq("id", messageId)
        .eq("user_id", userId)
        .maybeSingle();
      const row = data as { role?: string; text?: string } | null;
      return row?.role === "user" && row.text ? row.text : null;
    });
    if (!text) return { skipped: true };

    const reply = await step.run("think", () => runAgent(userId, text));

    await step.run("reply", async () => {
      await postBotMessage(userId, {
        text: reply.text,
        buttons: [],
        link: null,
        attachments: [],
        kind: "answer",
        refId: messageId,
      });
    });
    return { ok: true };
  }) as never,
);

/** After a request's question is answered, see whether a lasting rule follows. */
export const learnJob = inngest.createFunction(
  { id: "coach-learn-from-answer", retries: 1, triggers: [{ event: "coach/answer.given" }] },
  async ({ event, step }) => {
    const { userId, requestId } = event.data as { userId: string; requestId: string };
    const ruleId = await step.run("learn", () => learnFromAnswer(userId, requestId));
    return { ruleId };
  },
);
