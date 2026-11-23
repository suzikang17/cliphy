import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { createOutbox, judge, MAX_TRIES, type OutboxItem } from "../shareOutbox";

// Shared links are stored on the phone first and sent after, so the person
// is told at once and nothing is lost if the app is put away mid-send.

let stored: string | null;
let sent: string[];
let refused: { err: unknown; item: OutboxItem }[];
let fail: (url: string) => unknown;

const named = (name: string, more: object = {}) => Object.assign(new Error(name), { name }, more);
const offline = () => new TypeError("Network request failed");

const outbox = () =>
  createOutbox({
    load: async () => stored,
    save: async (value) => {
      stored = value;
    },
    send: async (item) => {
      const err = fail(item.url);
      if (err) throw err;
      sent.push(item.kind === "image" ? `image:${item.url}` : item.url);
    },
    refused: (err, item) => refused.push({ err, item }),
    now: () => new Date("2026-11-23T10:00:00Z"),
  });

const kept = () => (JSON.parse(stored ?? "[]") as OutboxItem[]).map((i) => i.url);

beforeEach(async () => {
  await layer("unit");
  await epic("Capture");
  await feature("Share outbox");
  stored = null;
  sent = [];
  refused = [];
  fail = () => undefined;
});

describe("judge", () => {
  it("tries again when the request did not get through or the server broke", () => {
    expect(judge(offline())).toBe("retry");
    expect(judge(Object.assign(new Error("API error 502"), { status: 502 }))).toBe("retry");
    expect(judge(named("AuthError"))).toBe("retry");
  });

  it("treats a link the server already has as done", () => {
    expect(judge(named("DuplicateError"))).toBe("have");
    // An article or post already saved comes back as a bare 409.
    expect(judge(Object.assign(new Error("API error 409"), { status: 409 }))).toBe("have");
  });

  it("gives up on what the server refused", () => {
    expect(judge(named("RateLimitError"))).toBe("refused");
    expect(judge(named("ProRequiredError"))).toBe("refused");
    expect(judge(Object.assign(new Error("Invalid YouTube URL"), { status: 400 }))).toBe("refused");
  });
});

describe("the outbox", () => {
  it("stores a link before sending it, then clears it once sent", async () => {
    const box = outbox();
    await box.add("https://youtu.be/a");
    expect(kept()).toEqual(["https://youtu.be/a"]);
    expect(sent).toEqual([]);
    await box.flush();
    expect(sent).toEqual(["https://youtu.be/a"]);
    expect(kept()).toEqual([]);
  });

  it("keeps a link when there is no network and sends it on a later launch", async () => {
    fail = offline;
    const first = outbox();
    await first.add("https://youtu.be/a");
    await first.flush();
    expect(kept()).toEqual(["https://youtu.be/a"]);
    expect(refused).toEqual([]);

    // The app was closed and opened again: a new outbox reads what was stored.
    fail = () => undefined;
    await outbox().flush();
    expect(sent).toEqual(["https://youtu.be/a"]);
    expect(kept()).toEqual([]);
  });

  it("stops at the first link that cannot get through, leaving the rest waiting", async () => {
    fail = offline;
    const box = outbox();
    await box.add("https://youtu.be/a");
    await box.add("https://youtu.be/b");
    await box.flush();
    expect(kept()).toEqual(["https://youtu.be/a", "https://youtu.be/b"]);
  });

  it("drops a link the server already has, without a word", async () => {
    fail = () => named("DuplicateError");
    const box = outbox();
    await box.add("https://youtu.be/a");
    await box.flush();
    expect(kept()).toEqual([]);
    expect(refused).toEqual([]);
  });

  it("drops a refused link, shows why, and still sends the next one", async () => {
    const limit = named("RateLimitError", { limit: 5, plan: "free" });
    fail = (url) => (url.endsWith("/a") ? limit : undefined);
    const box = outbox();
    await box.add("https://youtu.be/a");
    await box.add("https://youtu.be/b");
    await box.flush();
    expect(refused.map((r) => [r.err, r.item.url])).toEqual([[limit, "https://youtu.be/a"]]);
    expect(sent).toEqual(["https://youtu.be/b"]);
    expect(kept()).toEqual([]);
  });

  it("gives up on a link after enough failed tries, and shows the last failure", async () => {
    fail = offline;
    const box = outbox();
    await box.add("https://youtu.be/a");
    for (let i = 0; i < MAX_TRIES; i++) await box.flush();
    expect(kept()).toEqual([]);
    expect(refused).toHaveLength(1);
  });

  it("keeps one copy when the share sheet fires the same link twice", async () => {
    const box = outbox();
    await Promise.all([box.add("https://youtu.be/a"), box.add("https://youtu.be/a")]);
    await box.flush();
    expect(sent).toEqual(["https://youtu.be/a"]);
  });

  it("sends once when asked to flush twice at the same moment", async () => {
    const box = outbox();
    await box.add("https://youtu.be/a");
    await Promise.all([box.flush(), box.flush()]);
    expect(sent).toEqual(["https://youtu.be/a"]);
  });

  it("keeps a picture as the file on the phone and sends it as an upload", async () => {
    fail = offline;
    const first = outbox();
    await first.add("file:///cache/shot.jpg", "image");
    await first.flush();
    expect((JSON.parse(stored ?? "[]") as OutboxItem[])[0]).toMatchObject({
      kind: "image",
      url: "file:///cache/shot.jpg",
    });

    fail = () => undefined;
    await outbox().flush();
    expect(sent).toEqual(["image:file:///cache/shot.jpg"]);
    expect(kept()).toEqual([]);
  });

  it("sends a link stored before pictures existed as a link", async () => {
    stored = JSON.stringify([{ id: "1", url: "https://youtu.be/a", addedAt: "x", tries: 0 }]);
    await outbox().flush();
    expect(sent).toEqual(["https://youtu.be/a"]);
  });

  it("starts empty from a damaged store", async () => {
    stored = "{not json";
    const box = outbox();
    expect(await box.waiting()).toBe(0);
    await box.add("https://youtu.be/a");
    expect(kept()).toEqual(["https://youtu.be/a"]);
  });
});
