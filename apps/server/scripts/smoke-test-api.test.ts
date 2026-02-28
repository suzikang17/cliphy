/**
 * Live API smoke tests — creates a temp user, hits every endpoint, cleans up.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *
 * Optional:
 *   API_BASE_URL  (default: https://cliphy.vercel.app)
 *
 * Usage:
 *   pnpm test:smoke
 */

import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { epic, feature, layer } from "allure-js-commons";

// ── Helpers ──────────────────────────────────────────────────

let apiBase: string;

function api(path: string, token?: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetch(`${apiBase}${path}`, { ...init, headers });
}

// ── Setup / Teardown ─────────────────────────────────────────

let admin: SupabaseClient;
let token: string;
let userId: string;
let queueItemId: string | undefined;

beforeAll(async () => {
  apiBase = (process.env.API_BASE_URL ?? "https://cliphy.vercel.app").replace(/\/$/, "");
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;

  admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const testEmail = `smoke-${Date.now()}@cliphy-test.local`;
  const testPassword = `SmokeTest-${randomUUID()}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    throw new Error(`Failed to create test user: ${createErr?.message}`);
  }

  userId = created.user.id;

  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInErr || !session.session) {
    throw new Error(`Failed to sign in: ${signInErr?.message}`);
  }

  token = session.session.access_token;
});

afterAll(async () => {
  if (!userId) return;
  await admin.from("summaries").delete().eq("user_id", userId);
  await admin.from("users").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
});

// ── Tests ────────────────────────────────────────────────────

describe("Smoke Tests", () => {
  describe("Live API", () => {
    beforeEach(() => {
      layer("e2e");
      epic("End-to-End");
      feature("Live API");
    });

    test("GET /api/health returns 200", async () => {
      const res = await api("/api/health");
      expect(res.status).toBe(200);
    });

    test("unauthenticated request returns 401", async () => {
      const res = await api("/api/queue");
      expect(res.status).toBe(401);
    });

    test("POST /api/queue with valid video returns 201", async () => {
      const res = await api("/api/queue", token, {
        method: "POST",
        body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=jNQXAC9IVRw" }),
      });
      const json = (await res.json()) as { summary?: { id?: string; videoId?: string } };

      expect(res.status).toBe(201);
      expect(json.summary?.videoId).toBe("jNQXAC9IVRw");
      queueItemId = json.summary?.id;
    });

    test("POST /api/queue with duplicate returns 409", async () => {
      const res = await api("/api/queue", token, {
        method: "POST",
        body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=jNQXAC9IVRw" }),
      });
      const json = (await res.json()) as { code?: string };

      expect(res.status).toBe(409);
      expect(json.code).toBe("DUPLICATE");
    });

    test("POST /api/queue with invalid URL returns 400", async () => {
      const res = await api("/api/queue", token, {
        method: "POST",
        body: JSON.stringify({ videoUrl: "https://vimeo.com/123" }),
      });
      expect(res.status).toBe(400);
    });

    test("GET /api/queue returns items", async () => {
      const res = await api("/api/queue", token);
      const json = (await res.json()) as { items?: unknown[] };

      expect(res.status).toBe(200);
      expect(json.items).toBeInstanceOf(Array);
      expect(json.items!.length).toBeGreaterThan(0);
    });

    test("GET /api/usage returns usage data", async () => {
      const res = await api("/api/usage", token);
      const json = (await res.json()) as { usage?: { used?: number; limit?: number } };

      expect(res.status).toBe(200);
      expect(json.usage?.used).toBeTypeOf("number");
      expect(json.usage?.limit).toBeTypeOf("number");
    });

    test("GET /api/summaries returns list", async () => {
      const res = await api("/api/summaries", token);
      const json = (await res.json()) as { summaries?: unknown[] };

      expect(res.status).toBe(200);
      expect(json.summaries).toBeInstanceOf(Array);
    });

    test("DELETE /api/queue/:id removes item or rejects if processing", async () => {
      expect(queueItemId).toBeDefined();

      const res = await api(`/api/queue/${queueItemId}`, token, { method: "DELETE" });

      // 200 = deleted before Inngest picked it up
      // 409 = Inngest already moved it to "processing" (valid race condition)
      expect([200, 409]).toContain(res.status);
    });
  });

  describe("Security Hardening", () => {
    beforeEach(() => {
      layer("e2e");
      epic("Security");
      feature("Hardening");
    });

    test("POST /api/summarize returns 404 (removed endpoint)", async () => {
      const res = await api("/api/summarize", undefined, {
        method: "POST",
        body: JSON.stringify({ videoId: "abc123", videoTitle: "test" }),
      });
      expect(res.status).toBe(404);
    });

    test("security headers are present", async () => {
      const res = await api("/api/health");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("x-xss-protection")).toBe("0");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    test("CORS blocks non-whitelisted origins", async () => {
      const res = await fetch(`${apiBase}/api/health`, {
        headers: { Origin: "https://evil-site.example.com" },
      });
      // Server should NOT echo back the malicious origin
      const allowOrigin = res.headers.get("access-control-allow-origin");
      expect(allowOrigin).not.toBe("https://evil-site.example.com");
    });

    test("CORS preflight rejects non-whitelisted origin", async () => {
      const res = await fetch(`${apiBase}/api/queue`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil-site.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
      });
      const allowOrigin = res.headers.get("access-control-allow-origin");
      expect(allowOrigin).not.toBe("https://evil-site.example.com");
    });

    test("POST /api/queue with >500 char title returns 400", async () => {
      const longTitle = "A".repeat(501);
      const res = await api("/api/queue", token, {
        method: "POST",
        body: JSON.stringify({
          videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          videoTitle: longTitle,
        }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toContain("500");
    });

    test("search with special chars returns 200 (not 500)", async () => {
      const specialQueries = ["test,query", "test.query", "test(query)", 'test"query'];
      for (const q of specialQueries) {
        const res = await api(`/api/summaries/search?q=${encodeURIComponent(q)}`, token);
        expect(res.status, `search for "${q}" should not 500`).not.toBe(500);
        // Should be 200 (results, possibly empty) — the sanitizer strips special chars
        expect(res.status).toBe(200);
      }
    });

    test("Stripe webhook without signature returns 400", async () => {
      const res = await fetch(`${apiBase}/api/billing/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toContain("signature");
    });

    test("Stripe webhook with invalid signature returns 400", async () => {
      const res = await fetch(`${apiBase}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=1234,v1=fakesig",
        },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toContain("signature");
    });
  });
});
