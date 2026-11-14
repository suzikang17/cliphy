import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { createHash } from "crypto";
import { Hono } from "hono";
import { makeDb, passCoach, json, eqValue, type FakeDb } from "./helpers.js";

let db: FakeDb;
let authMethod = "jwt";
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => db.from(t) },
}));
vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      c.set("authMethod", authMethod);
      await next();
    },
  ),
}));
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const { pairRoutes, normalizeCode, PAIR_CODE_ALPHABET } = await import("../../pair.js");
const app = () => new Hono().route("/api/coach", coachRoutes).route("/api/pair", pairRoutes);
const post = (path: string, body?: unknown) => app().request(path, json("POST", body));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const future = () => new Date(Date.now() + 300_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

describe("mac helper pairing", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Pairing");
    db = makeDb();
    authMethod = "jwt";
  });

  describe("start (the Mac, not signed in)", () => {
    it("returns a code and a poll token, and stores only the token's hash", async () => {
      const res = await post("/api/pair/start");
      expect(res.status).toBe(201);
      const body = (await res.json()) as { code: string; pollToken: string; expiresAt: string };
      expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(body.pollToken.length).toBeGreaterThanOrEqual(32);
      const [row] = db.written("coach_pairings", "insert") as Record<string, unknown>[];
      expect(row.code).toBe(body.code.replace("-", ""));
      expect(row.poll_hash).toBe(sha(body.pollToken));
      expect(JSON.stringify(row)).not.toContain(body.pollToken);
      const ttl = new Date(body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60_000);
      expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    });

    it("leaves out characters that are easy to misread", () => {
      for (const ch of "01OIL") expect(PAIR_CODE_ALPHABET).not.toContain(ch);
    });

    it("refuses when too many codes are waiting", async () => {
      db = makeDb((op) =>
        op.table === "coach_pairings" && op.action === "select"
          ? ({ count: 200 } as never)
          : undefined,
      );
      const res = await post("/api/pair/start");
      expect(res.status).toBe(429);
      expect(db.written("coach_pairings", "insert")).toEqual([]);
    });
  });

  describe("claim (the phone, signed in)", () => {
    it("accepts the code however it was typed", () => {
      expect(normalizeCode(" abcd-efgh ")).toBe("ABCDEFGH");
      expect(normalizeCode("abcd efgh")).toBe("ABCDEFGH");
    });

    it("attaches an unclaimed, unexpired code to the signed-in account", async () => {
      db = makeDb((op) => (op.action === "update" ? { data: [{ id: "pair1" }] } : undefined));
      const res = await post("/api/coach/pair/claim", { code: "abcd-efgh" });
      expect(res.status).toBe(200);
      const op = db.ops.find((o) => o.action === "update")!;
      expect(op.table).toBe("coach_pairings");
      expect((op.payload as Record<string, unknown>).user_id).toBe("test-user-id");
      expect(eqValue(op, "code")).toBe("ABCDEFGH");
      // Only a code nobody has claimed, and only before it expires.
      expect(op.filters).toContainEqual(["is", "user_id", null]);
      expect(op.filters.some(([m, c]) => m === "gt" && c === "expires_at")).toBe(true);
    });

    it("says not found for a wrong, used or expired code", async () => {
      db = makeDb((op) => (op.action === "update" ? { data: [] } : undefined));
      const res = await post("/api/coach/pair/claim", { code: "ZZZZ-ZZZZ" });
      expect(res.status).toBe(404);
    });

    it("rejects a code of the wrong length without touching the database", async () => {
      const res = await post("/api/coach/pair/claim", { code: "abc" });
      expect(res.status).toBe(400);
      expect(db.ops).toEqual([]);
    });

    it("cannot be done with an API key", async () => {
      authMethod = "api_key";
      const res = await post("/api/coach/pair/claim", { code: "abcd-efgh" });
      expect(res.status).toBe(403);
      expect(db.writtenTables()).toEqual([]);
    });
  });

  describe("poll (the Mac)", () => {
    it("keeps waiting while nobody has claimed the code", async () => {
      db = makeDb((op) =>
        op.table === "coach_pairings" && op.action === "select"
          ? { data: { id: "pair1", user_id: null, expires_at: future() } }
          : undefined,
      );
      const res = await post("/api/pair/poll", { pollToken: "tok" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "waiting" });
      expect(db.writtenTables()).toEqual([]);
      const sel = db.ops.find((o) => o.table === "coach_pairings")!;
      expect(eqValue(sel, "poll_hash")).toBe(sha("tok"));
    });

    it("is gone for an unknown token", async () => {
      const res = await post("/api/pair/poll", { pollToken: "nope" });
      expect(res.status).toBe(410);
    });

    it("is gone once the code has expired, claimed or not", async () => {
      db = makeDb((op) =>
        op.table === "coach_pairings" && op.action === "select"
          ? { data: { id: "pair1", user_id: "u1", expires_at: past() } }
          : undefined,
      );
      const res = await post("/api/pair/poll", { pollToken: "tok" });
      expect(res.status).toBe(410);
      expect(db.written("api_keys")).toEqual([]);
    });

    const claimed = (deleted: unknown[]) =>
      makeDb((op) => {
        if (op.table === "coach_pairings" && op.action === "select")
          return { data: { id: "pair1", user_id: "u1", expires_at: future() } };
        if (op.table === "coach_pairings" && op.action === "delete") return { data: deleted };
        if (op.table === "users") return { data: { email: "maren@example.com" } };
        if (op.table === "api_keys" && op.action === "insert") return { data: { id: "k1" } };
        return undefined;
      });

    it("hands over a new key once, and names the account it belongs to", async () => {
      db = claimed([{ id: "pair1", user_id: "u1" }]);
      const res = await post("/api/pair/poll", { pollToken: "tok" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; apiKey: string; account: string };
      expect(body.status).toBe("paired");
      expect(body.apiKey).toMatch(/^cliphy_sk_/);
      expect(body.account).toBe("maren@example.com");
      const [key] = db.written("api_keys", "insert") as Record<string, unknown>[];
      expect(key).toMatchObject({ user_id: "u1", name: "Mac helper", key_hash: sha(body.apiKey) });
      // The pairing is used up before the key is made.
      const order = db.ops
        .filter((o) => o.action !== "select")
        .map((o) => `${o.table}:${o.action}`);
      expect(order.indexOf("coach_pairings:delete")).toBeLessThan(order.indexOf("api_keys:insert"));
    });

    it("replaces an earlier Mac helper key instead of piling them up", async () => {
      db = claimed([{ id: "pair1", user_id: "u1" }]);
      await post("/api/pair/poll", { pollToken: "tok" });
      const del = db.ops.find((o) => o.table === "api_keys" && o.action === "delete")!;
      expect(eqValue(del, "user_id")).toBe("u1");
      expect(eqValue(del, "name")).toBe("Mac helper");
    });

    it("gives no key when another poll already used the pairing", async () => {
      db = claimed([]);
      const res = await post("/api/pair/poll", { pollToken: "tok" });
      expect(res.status).toBe(410);
      expect(db.written("api_keys")).toEqual([]);
    });

    it("needs a token", async () => {
      expect((await post("/api/pair/poll", {})).status).toBe(400);
    });
  });
});
