/**
 * Live API smoke test — creates a temp user, hits every endpoint, cleans up.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *
 * Optional:
 *   API_BASE_URL  (default: https://cliphy.vercel.app)
 *
 * Usage:
 *   pnpm --filter server tsx scripts/smoke-test-api.ts
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

// ── Config ───────────────────────────────────────────────────

const API_BASE = (process.env.API_BASE_URL ?? "https://cliphy.vercel.app").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(
    "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY",
  );
  process.exit(1);
}

const TEST_EMAIL = `smoke-${Date.now()}@cliphy-test.local`;
const TEST_PASSWORD = `SmokeTest-${randomUUID()}`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ──────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

async function api(path: string, token?: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

// ── Setup / Teardown ─────────────────────────────────────────

async function setup(): Promise<{ userId: string; token: string }> {
  console.log(`Creating test user: ${TEST_EMAIL}`);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    throw new Error(`Failed to create test user: ${createErr?.message}`);
  }

  const userId = created.user.id;

  // Sign in to get a JWT (trigger creates public.users row automatically)
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInErr || !session.session) {
    throw new Error(`Failed to sign in: ${signInErr?.message}`);
  }

  console.log(`Authenticated as ${userId}\n`);
  return { userId, token: session.session.access_token };
}

async function cleanup(userId: string) {
  console.log("\nCleaning up...");
  await admin.from("summaries").delete().eq("user_id", userId);
  await admin.from("users").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("Test user removed.");
}

// ── Tests ────────────────────────────────────────────────────

async function runTests(token: string) {
  // 1. Health check
  {
    const res = await api("/api/health");
    record("GET /api/health", res.status === 200, `status=${res.status}`);
  }

  // 2. Unauthenticated request → 401
  {
    const res = await api("/api/queue");
    record("Unauthenticated → 401", res.status === 401, `status=${res.status}`);
  }

  // 3. Add video to queue → 201
  let queueItemId: string | undefined;
  {
    const res = await api("/api/queue", token, {
      method: "POST",
      body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=jNQXAC9IVRw" }),
    });
    const json = (await res.json()) as { summary?: { id?: string; videoId?: string } };
    const passed = res.status === 201 && json.summary?.videoId === "jNQXAC9IVRw";
    queueItemId = json.summary?.id;
    record(
      "POST /api/queue (valid)",
      passed,
      `status=${res.status}, videoId=${json.summary?.videoId}`,
    );
  }

  // 4. Duplicate → 409
  {
    const res = await api("/api/queue", token, {
      method: "POST",
      body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=jNQXAC9IVRw" }),
    });
    const json = (await res.json()) as { code?: string };
    record(
      "POST /api/queue (duplicate)",
      res.status === 409 && json.code === "DUPLICATE",
      `status=${res.status}, code=${json.code}`,
    );
  }

  // 5. Invalid URL → 400
  {
    const res = await api("/api/queue", token, {
      method: "POST",
      body: JSON.stringify({ videoUrl: "https://vimeo.com/123" }),
    });
    record("POST /api/queue (invalid URL)", res.status === 400, `status=${res.status}`);
  }

  // 6. List queue → 200
  {
    const res = await api("/api/queue", token);
    const json = (await res.json()) as { items?: unknown[] };
    const passed = res.status === 200 && Array.isArray(json.items) && json.items.length > 0;
    record("GET /api/queue", passed, `status=${res.status}, items=${json.items?.length}`);
  }

  // 7. Usage → 200
  {
    const res = await api("/api/usage", token);
    const json = (await res.json()) as { usage?: { used?: number; limit?: number } };
    const passed =
      res.status === 200 &&
      typeof json.usage?.used === "number" &&
      typeof json.usage?.limit === "number";
    record(
      "GET /api/usage",
      passed,
      `status=${res.status}, used=${json.usage?.used}, limit=${json.usage?.limit}`,
    );
  }

  // 8. Summaries list → 200
  {
    const res = await api("/api/summaries", token);
    const json = (await res.json()) as { summaries?: unknown[] };
    const passed = res.status === 200 && Array.isArray(json.summaries);
    record("GET /api/summaries", passed, `status=${res.status}, count=${json.summaries?.length}`);
  }

  // 9. Delete queue item → 200
  if (queueItemId) {
    const res = await api(`/api/queue/${queueItemId}`, token, { method: "DELETE" });
    const json = (await res.json()) as { deleted?: boolean };
    record(
      "DELETE /api/queue/:id",
      res.status === 200 && json.deleted === true,
      `status=${res.status}`,
    );
  } else {
    record("DELETE /api/queue/:id", false, "skipped — no queue item created");
  }
}

// ── Report ───────────────────────────────────────────────────

function report() {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  const lines = [
    `## API Smoke Test`,
    ``,
    `**${passed}/${total} passed** against \`${API_BASE}\``,
    ``,
    `| Test | Result | Detail |`,
    `|------|--------|--------|`,
    ...results.map((r) => `| ${r.name} | ${r.passed ? "PASS" : "FAIL"} | ${r.detail} |`),
  ];
  const md = lines.join("\n");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, md + "\n");
  }

  console.log(`\n${passed}/${total} tests passed.`);
  return passed === total;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`API Smoke Test — target: ${API_BASE}\n`);

  let userId: string | undefined;
  try {
    const ctx = await setup();
    userId = ctx.userId;
    await runTests(ctx.token);
  } catch (err) {
    console.error(`\nFatal error: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  } finally {
    if (userId) {
      await cleanup(userId).catch((err) =>
        console.error(`Cleanup failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  const allPassed = report();
  if (!allPassed) process.exitCode = 1;
}

main();
