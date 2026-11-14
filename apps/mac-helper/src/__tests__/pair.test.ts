import { describe, expect, it } from "vitest";
import { pairWithPhone, type PairDeps } from "../pair.js";

type Reply = { status: number; body: unknown };

function deps(replies: Reply[], over: Partial<PairDeps> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const shown: string[] = [];
  let clock = 0;
  const d: PairDeps = {
    post: async (url, body) => {
      calls.push({ url, body });
      const next = replies.shift();
      if (!next) throw new Error("no more replies");
      return next;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    show: (code) => shown.push(code),
    ...over,
  };
  return { d, calls, shown };
}

const started = {
  status: 201,
  body: { code: "ABCD-EFGH", pollToken: "tok", expiresAt: new Date(600_000).toISOString() },
};

describe("pairing the helper with the phone", () => {
  it("shows the code, waits, and returns the key and account once the phone confirms", async () => {
    const { d, calls, shown } = deps([
      started,
      { status: 200, body: { status: "waiting" } },
      { status: 200, body: { status: "waiting" } },
      { status: 200, body: { status: "paired", apiKey: "cliphy_sk_x", account: "m@example.com" } },
    ]);
    const result = await pairWithPhone("https://api.example.com/", d);
    expect(result).toEqual({ apiKey: "cliphy_sk_x", account: "m@example.com" });
    expect(shown).toEqual(["ABCD-EFGH"]);
    expect(calls[0].url).toBe("https://api.example.com/api/pair/start");
    expect(calls[1]).toEqual({
      url: "https://api.example.com/api/pair/poll",
      body: { pollToken: "tok" },
    });
    expect(calls).toHaveLength(4);
  });

  it("stops with a plain message when the code expires on the server", async () => {
    const { d } = deps([started, { status: 410, body: { error: "expired" } }]);
    await expect(pairWithPhone("https://api.example.com", d)).rejects.toThrow(/expired/i);
  });

  it("stops by itself once the code's time is up, without asking for ever", async () => {
    const replies: Reply[] = [started];
    for (let i = 0; i < 1000; i++) replies.push({ status: 200, body: { status: "waiting" } });
    const { d, calls } = deps(replies);
    await expect(pairWithPhone("https://api.example.com", d)).rejects.toThrow(/expired/i);
    expect(calls.length).toBeLessThan(400);
  });

  it("keeps waiting through a dropped connection", async () => {
    let n = 0;
    const { d } = deps([], {
      post: async () => {
        n++;
        if (n === 1) return started;
        if (n === 2) throw new Error("network");
        return { status: 200, body: { status: "paired", apiKey: "k", account: null } };
      },
    });
    expect(await pairWithPhone("https://api.example.com", d)).toEqual({
      apiKey: "k",
      account: null,
    });
  });

  it("says so when the server will not start pairing", async () => {
    const { d } = deps([{ status: 429, body: { error: "Try again in a few minutes" } }]);
    await expect(pairWithPhone("https://api.example.com", d)).rejects.toThrow(/Try again/);
  });
});
