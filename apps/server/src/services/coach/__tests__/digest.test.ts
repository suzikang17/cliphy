import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { buildDigestPrompt, parseDigest, type DigestContext } from "../digest.js";

// A stretch of one person's texts, read once, into the distinct things they
// asked for: grouped, each with the words they used. The model proposes; this
// code checks every id and every quote against what is actually stored.

const ctx: DigestContext = {
  personName: "Maren",
  today: "2026-11-18",
  messages: [
    {
      id: "m1",
      sentAt: "2026-11-17T10:00:00Z",
      direction: "in",
      text: "Hi! Could the photo be further down and one of these the front pic instead.\nAlso add the wording I wrote out to the front page.",
      pictures: 2,
    },
    { id: "m2", sentAt: "2026-11-17T10:05:00Z", direction: "out", text: "On it", pictures: 0 },
    { id: "m3", sentAt: "2026-11-17T12:00:00Z", direction: "in", text: "", pictures: 1 },
  ],
  openTasks: [{ id: "t1", title: "Swap front image" }],
  projects: [{ id: "p1", name: "Alder House" }],
};

const item = (over: Record<string, unknown> = {}) => ({
  title: "Move the photo down",
  detail: "The current front photo should sit further down the page.",
  quotes: [{ messageId: "m1", text: "Could the photo be further down" }],
  taskId: null,
  projectId: "p1",
  dueDate: null,
  answered: false,
  ...over,
});

beforeEach(async () => {
  await layer("unit");
  await epic("Coach");
  await feature("Digest");
});

describe("buildDigestPrompt", () => {
  it("gives the model each message with its id, who sent it and how many pictures", () => {
    const { user } = buildDigestPrompt(ctx);
    expect(user).toContain("Today: 2026-11-18");
    expect(user).toContain("[m1] 2026-11-17 Maren (2 pictures):");
    expect(user).toContain("Could the photo be further down");
    expect(user).toContain("[m2] 2026-11-17 Me:");
    expect(user).toContain("[m3] 2026-11-17 Maren (1 picture):");
    expect(user).toContain("t1: Swap front image");
    expect(user).toContain("p1: Alder House");
  });
});

describe("parseDigest", () => {
  it("keeps a group of requests with quotes that are in the messages word for word", () => {
    const out = parseDigest({ groups: [{ name: "Front page", items: [item()] }] }, ctx);
    expect(out).toEqual([
      {
        name: "Front page",
        items: [
          {
            title: "Move the photo down",
            detail: "The current front photo should sit further down the page.",
            quotes: [{ messageId: "m1", text: "Could the photo be further down" }],
            taskId: null,
            projectId: "p1",
            dueDate: null,
            answered: false,
          },
        ],
      },
    ]);
  });

  it("matches a quote whatever the spacing and line breaks, and returns the message's own characters", () => {
    const out = parseDigest(
      {
        groups: [
          {
            name: "Front page",
            items: [
              item({
                quotes: [
                  { messageId: "m1", text: "front pic instead.  Also add the wording I wrote out" },
                ],
              }),
            ],
          },
        ],
      },
      ctx,
    );
    expect(out[0].items[0].quotes[0].text).toBe(
      "front pic instead.\nAlso add the wording I wrote out",
    );
  });

  it("shows the whole message when the quote is not what was written", () => {
    const out = parseDigest(
      {
        groups: [
          {
            name: "x",
            items: [item({ quotes: [{ messageId: "m1", text: "Please move the photo lower" }] })],
          },
        ],
      },
      ctx,
    );
    expect(out[0].items[0].quotes[0]).toEqual({ messageId: "m1", text: ctx.messages[0].text });
  });

  it("keeps a picture-only message as a quote with no words", () => {
    const out = parseDigest(
      {
        groups: [
          { name: "x", items: [item({ quotes: [{ messageId: "m3", text: "see photo" }] })] },
        ],
      },
      ctx,
    );
    expect(out[0].items[0].quotes).toEqual([{ messageId: "m3", text: "" }]);
  });

  it("drops quotes of unknown messages and of my own messages, and an item left with none", () => {
    const out = parseDigest(
      {
        groups: [
          {
            name: "x",
            items: [
              item({
                title: "kept",
                quotes: [
                  { messageId: "nope", text: "a" },
                  { messageId: "m1", text: "Hi!" },
                ],
              }),
              item({ title: "mine only", quotes: [{ messageId: "m2", text: "On it" }] }),
              item({ title: "none", quotes: [] }),
            ],
          },
          { name: "empty", items: [item({ quotes: [{ messageId: "nope", text: "a" }] })] },
        ],
      },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.title)).toEqual(["kept"]);
    expect(out[0].items[0].quotes).toEqual([{ messageId: "m1", text: "Hi!" }]);
  });

  it("keeps only ids it was given and dates that are dates", () => {
    const out = parseDigest(
      {
        groups: [
          {
            name: "",
            items: [
              item({ taskId: "t1", projectId: "p9", dueDate: "next Friday", answered: "yes" }),
              item({ taskId: "t9", projectId: "p1", dueDate: "2026-11-21", answered: true }),
            ],
          },
        ],
      },
      ctx,
    );
    expect(out[0].name).toBe("Other");
    expect(out[0].items.map((i) => [i.taskId, i.projectId, i.dueDate, i.answered])).toEqual([
      ["t1", null, null, false],
      [null, "p1", "2026-11-21", true],
    ]);
  });

  it("returns nothing for output that is not the expected shape", () => {
    expect(parseDigest(null, ctx)).toEqual([]);
    expect(parseDigest({ groups: "x" }, ctx)).toEqual([]);
    expect(
      parseDigest({ groups: [{ name: "x", items: [{ title: "", quotes: [] }] }] }, ctx),
    ).toEqual([]);
  });
});
