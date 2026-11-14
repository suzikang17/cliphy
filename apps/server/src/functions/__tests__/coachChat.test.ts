import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_c: unknown, fn: unknown) => fn, send: vi.fn() },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const runAgent = vi.fn();
const learnFromAnswer = vi.fn();
vi.mock("../../services/coach/agent.js", () => ({
  runAgent: (...a: unknown[]) => runAgent(...a),
  learnFromAnswer: (...a: unknown[]) => learnFromAnswer(...a),
}));
const postBot = vi.fn();
vi.mock("../../services/coach/chat.js", () => ({
  postBotMessage: (...a: unknown[]) => postBot(...a),
}));

const { chatReply, learnJob, CHAT_JOB, LEARN_JOB, replyFailed } = await import("../coachChat.js");

const step = { run: async (_n: string, fn: () => Promise<unknown>) => fn() };
const reply = (data: unknown) =>
  (chatReply as unknown as (a: unknown) => Promise<unknown>)({ event: { data }, step });

describe("coach chat jobs", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Chat");
    runAgent.mockReset();
    learnFromAnswer.mockReset();
    postBot.mockReset();
    db = makeDb((op: Op) =>
      op.table === "coach_chat_messages"
        ? { data: { id: "m1", role: "user", text: "only the words" } }
        : undefined,
    );
  });

  // Review Focus 1: the job retries after posting.
  it("answers what the user typed, keyed on their message so a retry cannot answer twice", async () => {
    runAgent.mockResolvedValue({ text: "Saved. 2 tasks added." });
    await reply({ userId: "u1", messageId: "m1" });
    expect(runAgent).toHaveBeenCalledWith("u1", "only the words");
    expect(postBot).toHaveBeenCalledWith("u1", {
      text: "Saved. 2 tasks added.",
      buttons: [],
      link: null,
      attachments: [],
      kind: "answer",
      refId: "m1",
    });
  });

  it("answers one message at a time per user, so replies stay in order", () => {
    expect(CHAT_JOB).toMatchObject({
      concurrency: [{ key: "event.data.userId", limit: 1 }],
      triggers: [{ event: "coach/chat.message" }],
    });
    expect(CHAT_JOB.onFailure).toEqual(expect.any(Function));
  });

  it("does nothing for a message that is gone or is not the user's", async () => {
    db = makeDb(() => ({ data: null }));
    await reply({ userId: "u1", messageId: "nope" });
    expect(runAgent).not.toHaveBeenCalled();
    expect(postBot).not.toHaveBeenCalled();
  });

  it("says so in the thread when it could not answer, once, without inviting a blind retry", async () => {
    await replyFailed("u1", "m1");
    expect(postBot).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        text: "I hit a problem part-way. Check Up next before asking again.",
        kind: "answer",
        refId: "m1",
      }),
    );
  });

  // A retry would run the agent's tools a second time.
  it("never re-runs the agent automatically, so nothing it did is done twice", () => {
    expect(CHAT_JOB.retries).toBe(0);
    expect(LEARN_JOB.retries).toBe(0);
  });

  it("runs the learning step for an answered request", async () => {
    await (learnJob as unknown as (a: unknown) => Promise<unknown>)({
      event: { data: { userId: "u1", requestId: "r1" } },
      step,
    });
    expect(learnFromAnswer).toHaveBeenCalledWith("u1", "r1");
  });
});
