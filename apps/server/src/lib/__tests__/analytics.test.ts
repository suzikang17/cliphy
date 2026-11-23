import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// What is sent to PostHog, and when nothing is.

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: { user_id: "u1", source_type: "youtube" } });
      return chain;
    },
  },
}));

const { track, saveKind, trackSaves, trackClipOutcome } = await import("../analytics.js");

const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
  }));
let fetchMock: ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("track", () => {
  it("sends the event under the account id, with nothing else about the person", async () => {
    await track("u1", "clip_saved", { kind: "video" });
    expect(sent()).toEqual([
      {
        url: "https://us.i.posthog.com/i/v0/e/",
        body: {
          api_key: expect.stringMatching(/^phc_/),
          event: "clip_saved",
          distinct_id: "u1",
          properties: { kind: "video", $lib: "cliphy-server" },
          timestamp: expect.any(String),
        },
      },
    ]);
  });

  it("sends nothing outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    await track("u1", "clip_saved");
    vi.stubEnv("VERCEL_ENV", "");
    await track("u1", "clip_saved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a failure to send", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(track("u1", "clip_saved")).resolves.toBeUndefined();
  });
});

describe("saveKind", () => {
  it.each([
    ["POST", "/api/queue", "video"],
    ["POST", "/api/queue/", "video"],
    ["POST", "/api/queue/batch", "video_batch"],
    ["POST", "/api/clips", "clip"],
    ["POST", "/api/clips/quick", "quick"],
    ["POST", "/api/notes", "note"],
    ["POST", "/api/notes/voice", "voice"],
    ["GET", "/api/queue", null],
    ["POST", "/api/queue/abc/retry", null],
    ["POST", "/api/notes/voice/upload-url", null],
    ["POST", "/api/digest/x/keep", null],
  ])("%s %s → %s", (method, path, kind) => {
    expect(saveKind(method, path)).toBe(kind);
  });
});

describe("trackSaves", () => {
  const app = (status: number, body: unknown, signedIn = true) => {
    const a = new Hono<AppEnv>().basePath("/api");
    a.use("*", trackSaves);
    a.post("/queue", (c) => {
      if (signedIn) {
        c.set("userId", "u1");
        c.set("authMethod", "jwt");
      }
      return c.json(body as object, status as 200);
    });
    a.get("/queue", (c) => {
      c.set("userId", "u1");
      return c.json({});
    });
    return a;
  };
  const post = (a: Hono<AppEnv>) =>
    a.request("/api/queue", {
      method: "POST",
      headers: { Origin: "chrome-extension://abc" },
    });

  it("records a stored save, with the app it came from", async () => {
    const res = await post(app(201, { summary: {} }));
    await flush();
    expect(res.status).toBe(201);
    expect(sent().map((s) => s.body)).toEqual([
      expect.objectContaining({
        event: "clip_saved",
        distinct_id: "u1",
        properties: expect.objectContaining({ kind: "video", client: "extension", auth: "jwt" }),
      }),
    ]);
  });

  it("records a refused save with its status and code, and leaves the answer intact", async () => {
    const res = await post(
      app(429, { error: "Monthly summary limit reached", code: "RATE_LIMITED" }),
    );
    await flush();
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(sent()[0].body).toMatchObject({
      event: "save_refused",
      properties: expect.objectContaining({ status: 429, code: "RATE_LIMITED", kind: "video" }),
    });
    // The refusal's words are not sent.
    expect(JSON.stringify(sent()[0].body)).not.toContain("Monthly summary");
  });

  it("records nothing for a request that was not signed in, or is not a save", async () => {
    await post(app(401, { error: "Unauthorized" }, false));
    await app(200, {}).request("/api/queue");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trackClipOutcome", () => {
  it("records a finished summary against the clip's owner", async () => {
    await trackClipOutcome("c1", "summary_completed");
    expect(sent()[0].body).toMatchObject({
      event: "summary_completed",
      distinct_id: "u1",
      properties: expect.objectContaining({ kind: "youtube" }),
    });
  });
});
