import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type Anthropic from "@anthropic-ai/sdk";
import type { InboundMessage } from "@cliphy/shared";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  },
}));

const { parseInterpretation, buildInterpretMessages, interpretBundle, INTERPRET_MODEL } =
  await import("../interpret.js");
type InterpretContext = import("../interpret.js").InterpretContext;

const ctx: InterpretContext = {
  person: { id: "p1", name: "Maren" },
  today: "2026-11-14",
  projects: [{ id: "pr1", name: "Alder House", hints: "" }],
  recentRequests: [
    {
      id: "r-2022",
      projectId: "pr1",
      understood: "Maren asked for the Alder House page 2 text.",
    },
  ],
  waitingAsks: [{ id: "t-ask", title: "Words or type?" }],
  fixNote: null,
};

const textMessage = (text: string): InboundMessage => ({
  id: "m1",
  personId: "p1",
  channel: "imessage",
  direction: "in",
  text,
  attachments: [],
  sentAt: "2026-11-14T09:42:00Z",
});

describe("coach interpretation", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Interpretation");
    createMock.mockReset();
  });

  describe("parseInterpretation", () => {
    it("keeps a well-formed request with its chain", () => {
      const out = parseInterpretation(
        {
          kind: "request",
          understood: "Maren asked to replace the page 2 text.",
          projectId: "pr1",
          question: { text: "Words or type?", options: ["Only words", "Type too", "Ask Maren"] },
          replacesRequestId: "r-2022",
          tasks: [
            {
              kind: "ask",
              title: "Words or type?",
              withPerson: true,
              after: null,
              answersQuestion: true,
              kit: {},
            },
            {
              kind: "do",
              title: "Replace page 2 copy",
              withPerson: false,
              after: 0,
              answersQuestion: false,
              kit: { doneWhen: "New copy is live", bogus: 1 },
            },
            {
              kind: "tell",
              title: "Tell Maren it's live",
              withPerson: true,
              after: 1,
              answersQuestion: false,
              kit: {},
            },
          ],
        },
        ctx,
      );
      expect(out.kind).toBe("request");
      expect(out.tasks.map((t) => t.kind)).toEqual(["ask", "do", "tell"]);
      expect(out.tasks[2].after).toBe(1);
      expect(out.tasks[1].kit).toEqual({ doneWhen: "New copy is live" });
      expect(out.replacesRequestId).toBe("r-2022");
      expect(out.projectId).toBe("pr1");
    });

    // Review Focus 3: ids the model made up, or that belong to someone else.
    it("drops ids that are not in the context", () => {
      const out = parseInterpretation(
        {
          kind: "request",
          understood: "x",
          projectId: "someone-elses",
          replacesRequestId: "nope",
          repliesToTaskId: "nope",
          tasks: [],
        },
        ctx,
      );
      expect(out.projectId).toBeNull();
      expect(out.replacesRequestId).toBeNull();
      expect(out.repliesToTaskId).toBeNull();
    });

    it("caps question options at three and drops empties", () => {
      const out = parseInterpretation(
        {
          kind: "request",
          understood: "x",
          question: { text: "Which?", options: ["A", " ", "B", "C", "D"] },
          tasks: [],
        },
        ctx,
      );
      expect(out.question?.options).toEqual(["A", "B", "C"]);
    });

    it("drops a question with no text", () => {
      const out = parseInterpretation(
        { kind: "request", understood: "x", question: { text: " ", options: ["A"] }, tasks: [] },
        ctx,
      );
      expect(out.question).toBeNull();
    });

    it("nulls an after that points forward or at itself", () => {
      const out = parseInterpretation(
        {
          kind: "request",
          understood: "x",
          tasks: [
            { kind: "do", title: "a", after: 1 },
            { kind: "tell", title: "b", after: 1 },
          ],
        },
        ctx,
      );
      expect(out.tasks.map((t) => t.after)).toEqual([null, null]);
    });

    it("re-points after when an earlier task is dropped as invalid", () => {
      const out = parseInterpretation(
        {
          kind: "request",
          understood: "x",
          tasks: [
            { kind: "do", title: "first" },
            { kind: "dance", title: "not a kind" },
            { kind: "tell", title: "third", after: 0 },
            { kind: "get", title: "fourth", after: 1 },
          ],
        },
        ctx,
      );
      expect(out.tasks.map((t) => [t.title, t.after])).toEqual([
        ["first", null],
        ["third", 0],
        ["fourth", null],
      ]);
    });

    it("allows only one task to answer the question, and none without a question", () => {
      const tasks = [
        { kind: "ask", title: "a", answersQuestion: true },
        { kind: "ask", title: "b", answersQuestion: true },
      ];
      const withQ = parseInterpretation(
        { kind: "request", understood: "x", question: { text: "q", options: [] }, tasks },
        ctx,
      );
      expect(withQ.tasks.map((t) => t.answersQuestion)).toEqual([true, false]);
      const without = parseInterpretation({ kind: "request", understood: "x", tasks }, ctx);
      expect(without.tasks.map((t) => t.answersQuestion)).toEqual([false, false]);
    });

    it("drops a due date in the past and keeps one from today on", () => {
      const past = parseInterpretation(
        { kind: "request", understood: "x", dueDate: "2026-11-01", tasks: [] },
        ctx,
      );
      expect(past.dueDate).toBeNull();
      const ok = parseInterpretation(
        { kind: "request", understood: "x", dueDate: "2026-11-18", tasks: [] },
        ctx,
      );
      expect(ok.dueDate).toBe("2026-11-18");
      const junk = parseInterpretation(
        { kind: "request", understood: "x", dueDate: "Wednesday", tasks: [] },
        ctx,
      );
      expect(junk.dueDate).toBeNull();
    });

    it("ignores a new project name when an existing project was chosen", () => {
      const out = parseInterpretation(
        { kind: "request", understood: "x", projectId: "pr1", newProjectName: "Other", tasks: [] },
        ctx,
      );
      expect(out.newProjectName).toBeNull();
    });

    it("strips tasks and question from ordinary chat", () => {
      const out = parseInterpretation(
        {
          kind: "chat",
          understood: "",
          question: { text: "q", options: ["a"] },
          replacesRequestId: "r-2022",
          tasks: [{ kind: "do", title: "a" }],
        },
        ctx,
      );
      expect(out.tasks).toEqual([]);
      expect(out.question).toBeNull();
      expect(out.replacesRequestId).toBeNull();
    });

    it("keeps the waiting ask a reply answers", () => {
      const out = parseInterpretation(
        { kind: "reply", understood: "Maren said only the words.", repliesToTaskId: "t-ask" },
        ctx,
      );
      expect(out).toMatchObject({ kind: "reply", repliesToTaskId: "t-ask", tasks: [] });
    });

    it("treats a request with nothing understood as chat", () => {
      expect(parseInterpretation({ kind: "request", understood: "  " }, ctx).kind).toBe("chat");
    });

    it("turns unusable input into chat without throwing", () => {
      expect(parseInterpretation("not an object", ctx).kind).toBe("chat");
      expect(parseInterpretation(null, ctx).kind).toBe("chat");
      expect(parseInterpretation({ kind: "banana" }, ctx).kind).toBe("chat");
    });
  });

  describe("buildInterpretMessages", () => {
    // Review Focus 2: two screenshots and nothing typed.
    it("builds a message for a bundle that has images and no text", () => {
      const msgs = buildInterpretMessages(
        [
          {
            ...textMessage(""),
            attachments: [{ storagePath: "coach/u/a.png", mediaType: "image/png" }],
          },
        ],
        [{ bytes: Buffer.from("x"), mediaType: "image/png" }],
        ctx,
      );
      const blocks = msgs.at(-1)!.content as Anthropic.ContentBlockParam[];
      expect(blocks.some((b) => b.type === "image")).toBe(true);
      expect(JSON.stringify(blocks)).toContain("(no text was sent with these)");
    });

    it("gives the model the ids it may refer to", () => {
      const text = JSON.stringify(buildInterpretMessages([textMessage("hi")], [], ctx));
      expect(text).toContain("pr1");
      expect(text).toContain("r-2022");
      expect(text).toContain("t-ask");
      expect(text).toContain("2026-11-14");
    });

    it("says who wrote each text, in time order", () => {
      const msgs = buildInterpretMessages(
        [
          { ...textMessage("second"), id: "m2", sentAt: "2026-11-14T09:43:00Z" },
          { ...textMessage("first"), sentAt: "2026-11-14T09:42:00Z" },
        ],
        [],
        ctx,
      );
      const text = JSON.stringify(msgs);
      expect(text.indexOf("first")).toBeLessThan(text.indexOf("second"));
      expect(text).toContain("Maren");
    });

    it("leaves out an image format the model cannot read and says so", () => {
      const msgs = buildInterpretMessages(
        [textMessage("see photo")],
        [{ bytes: Buffer.from("x"), mediaType: "image/heic" }],
        ctx,
      );
      const blocks = msgs.at(-1)!.content as Anthropic.ContentBlockParam[];
      expect(blocks.some((b) => b.type === "image")).toBe(false);
      expect(JSON.stringify(blocks)).toContain("1 image could not be read");
    });

    it("sends at most 8 images and says how many were left out", () => {
      const images = Array.from({ length: 11 }, () => ({
        bytes: Buffer.from("x"),
        mediaType: "image/png",
      }));
      const blocks = buildInterpretMessages([textMessage("photos")], images, ctx).at(-1)!
        .content as Anthropic.ContentBlockParam[];
      expect(blocks.filter((b) => b.type === "image")).toHaveLength(8);
      expect(JSON.stringify(blocks)).toContain("3 images could not be read");
    });

    it("leaves out an image too large to send", () => {
      const big = { bytes: Buffer.alloc(3_600_000), mediaType: "image/jpeg" };
      const blocks = buildInterpretMessages([textMessage("photo")], [big], ctx).at(-1)!
        .content as Anthropic.ContentBlockParam[];
      expect(blocks.some((b) => b.type === "image")).toBe(false);
      expect(JSON.stringify(blocks)).toContain("1 image could not be read");
    });

    it("includes the correction when the user said the first reading was wrong", () => {
      const text = JSON.stringify(
        buildInterpretMessages([textMessage("hi")], [], { ...ctx, fixNote: "It's the homepage" }),
      );
      expect(text).toContain("It's the homepage");
    });
  });

  describe("interpretBundle", () => {
    it("calls the model once, offering the tool, and returns the parsed result", async () => {
      createMock.mockResolvedValue({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "record_interpretation",
            input: { kind: "chat", understood: "" },
          },
        ],
      });
      const out = await interpretBundle([textMessage("thanks!")], [], ctx);
      expect(out.kind).toBe("chat");
      expect(createMock).toHaveBeenCalledTimes(1);
      const req = createMock.mock.calls[0][0];
      expect(req).toMatchObject({ model: "claude-opus-5-5", tool_choice: { type: "auto" } });
      expect(req.model).toBe(INTERPRET_MODEL);
      expect(req.tools.map((t: { name: string }) => t.name)).toEqual(["record_interpretation"]);
    });

    it("throws when the model answers without calling the tool", async () => {
      createMock.mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "This looks like a request." }],
      });
      await expect(interpretBundle([textMessage("hi")], [], ctx)).rejects.toThrow(
        /no interpretation/i,
      );
    });

    it("throws when the model refuses", async () => {
      createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });
      await expect(interpretBundle([textMessage("hi")], [], ctx)).rejects.toThrow(/refus/i);
    });
  });
});
