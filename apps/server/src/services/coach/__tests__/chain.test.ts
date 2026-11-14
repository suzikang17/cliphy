import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { ProposedTask } from "@cliphy/shared";
import { materializeChain, isBlocked, stateAfterSent } from "../chain.js";

const proposed: ProposedTask[] = [
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
    kit: { doneWhen: "Live" },
  },
  {
    kind: "tell",
    title: "Tell Maren it's live",
    withPerson: true,
    after: 1,
    answersQuestion: false,
    kit: {},
  },
];

describe("coach task chain", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Task chain");
  });

  it("keeps the whole chain when the question is unanswered", () => {
    const chain = materializeChain(proposed, { answered: false });
    expect(chain.map((t) => [t.kind, t.afterIndex])).toEqual([
      ["ask", null],
      ["do", 0],
      ["tell", 1],
    ]);
    expect(chain.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("drops the ask and re-points the chain when the question was answered", () => {
    const chain = materializeChain(proposed, { answered: true });
    expect(chain.map((t) => [t.kind, t.afterIndex])).toEqual([
      ["do", null],
      ["tell", 0],
    ]);
    expect(chain[0].kit).toEqual({ doneWhen: "Live" });
    expect(chain.map((t) => t.position)).toEqual([0, 1]);
  });

  it("re-points a dependent to what the dropped ask itself waited for", () => {
    const chain = materializeChain(
      [
        {
          kind: "get",
          title: "Get the file",
          withPerson: false,
          after: null,
          answersQuestion: false,
          kit: {},
        },
        {
          kind: "ask",
          title: "Which one?",
          withPerson: true,
          after: 0,
          answersQuestion: true,
          kit: {},
        },
        {
          kind: "do",
          title: "Use it",
          withPerson: false,
          after: 1,
          answersQuestion: false,
          kit: {},
        },
      ],
      { answered: true },
    );
    expect(chain.map((t) => [t.kind, t.afterIndex])).toEqual([
      ["get", null],
      ["do", 0],
    ]);
  });

  it("keeps an ask that is not about the open question even when answered", () => {
    const chain = materializeChain(
      [
        {
          kind: "ask",
          title: "Send the logo",
          withPerson: true,
          after: null,
          answersQuestion: false,
          kit: {},
        },
      ],
      { answered: true },
    );
    expect(chain).toHaveLength(1);
  });

  it("is blocked while the predecessor is open or waiting, not when done or dropped", () => {
    const byId = new Map([
      ["a", { state: "waiting" as const }],
      ["b", { state: "done" as const }],
      ["c", { state: "dropped" as const }],
      ["d", { state: "open" as const }],
    ]);
    expect(isBlocked({ afterTaskId: "a" }, byId)).toBe(true);
    expect(isBlocked({ afterTaskId: "d" }, byId)).toBe(true);
    expect(isBlocked({ afterTaskId: "b" }, byId)).toBe(false);
    expect(isBlocked({ afterTaskId: "c" }, byId)).toBe(false);
    expect(isBlocked({ afterTaskId: null }, byId)).toBe(false);
  });

  it("is not blocked by a predecessor that no longer exists", () => {
    expect(isBlocked({ afterTaskId: "gone" }, new Map())).toBe(false);
  });

  it("sent moves an ask to waiting and a tell to done, and nothing else", () => {
    expect(stateAfterSent("ask")).toBe("waiting");
    expect(stateAfterSent("tell")).toBe("done");
    expect(stateAfterSent("do")).toBeNull();
    expect(stateAfterSent("get")).toBeNull();
  });
});
