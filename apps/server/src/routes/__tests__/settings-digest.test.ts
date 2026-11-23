import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { makeDb, passAuth, json, type FakeDb } from "../coach/__tests__/helpers.js";

// The weekly digest switch in settings.

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../middleware/auth.js", () => passAuth);
const send = vi.fn();
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

const { settingsRoutes } = await import("../settings.js");
const app = () => new Hono().route("/settings", settingsRoutes);
const patch = (body: unknown) => app().request("/settings", json("PATCH", body));

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb(() => ({ data: { summary_language: "en", weekly_digest: true } }));
});

describe("PATCH /settings weeklyDigest", () => {
  it("turns the digest on and builds the first one straight away", async () => {
    const res = await patch({ weeklyDigest: true });

    expect(await res.json()).toMatchObject({ weeklyDigest: true });
    expect(db.written("user_settings", "upsert")).toEqual([
      { user_id: "test-user-id", weekly_digest: true },
    ]);
    expect(send).toHaveBeenCalledWith({
      name: "digest/build.requested",
      data: { userId: "test-user-id" },
    });
  });

  it("turns it off without building anything", async () => {
    await patch({ weeklyDigest: false });
    expect(db.written("user_settings", "upsert")).toEqual([
      { user_id: "test-user-id", weekly_digest: false },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("still saves the switch when the build cannot be requested", async () => {
    send.mockRejectedValue(new Error("inngest down"));
    expect((await patch({ weeklyDigest: true })).status).toBe(200);
  });

  it("refuses a value that is not on or off, and leaves other settings alone", async () => {
    expect((await patch({ weeklyDigest: "yes" })).status).toBe(400);
    await patch({ autoDiscoverPlaylists: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the digest as off for someone who never set it", async () => {
    db = makeDb(() => ({ data: null }));
    const res = await app().request("/settings");
    expect(await res.json()).toMatchObject({ weeklyDigest: false, autoDiscoverPlaylists: true });
  });
});
