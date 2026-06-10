---
title: "Email-First Auth Flow Implementation Plan"
date: 2026-06-07
---

# Email-First Auth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile single-screen login with an email-first wizard that branches to sign-up, password login, or a Google nudge, plus a password-reset flow.

**Architecture:** A new service-role-only Postgres function classifies an email (`new`/`password`/`google`); a public `POST /api/auth/check-email` endpoint exposes it; the Expo login screen becomes a two-step wizard driven by that status; a deep-linked reset screen handles "forgot password".

**Tech Stack:** Hono + Supabase (service role) + Vitest (server); Expo Router + React Native + `@supabase/supabase-js` PKCE (mobile); `@cliphy/shared` for shared types/utils.

**Spec:** `docs/superpowers/specs/2026-06-07-email-first-auth-design.md`

---

## File Structure

- `apps/server/supabase/migrations/011_email_auth_status.sql` — **create** — DB function `email_auth_status`.
- `packages/shared/src/types.ts` — **modify** — add `EmailAuthStatus` + `CheckEmailResponse`.
- `packages/shared/src/utils.ts` — **modify** — add `isValidEmail`.
- `apps/server/src/lib/rateLimit.ts` — **create** — best-effort in-memory IP limiter.
- `apps/server/src/lib/__tests__/rateLimit.test.ts` — **create** — limiter tests.
- `apps/server/src/routes/auth.ts` — **modify** — add `POST /check-email`.
- `apps/server/src/routes/__tests__/checkEmail.test.ts` — **create** — endpoint tests.
- `apps/mobile/lib/api.ts` — **modify** — add `checkEmail`.
- `apps/mobile/lib/auth.ts` — **modify** — add `resetPassword`, `updatePassword`, `exchangeRecoveryCode`.
- `apps/mobile/app/(auth)/login.tsx` — **rewrite** — two-step wizard.
- `apps/mobile/app/(auth)/reset.tsx` — **create** — set-new-password screen.

---

## Task 1: DB function `email_auth_status`

**Files:**

- Create: `apps/server/supabase/migrations/011_email_auth_status.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 011_email_auth_status.sql
-- Classifies an email for the email-first auth flow.
--   'new'      → no account with this email
--   'password' → account has an email/password identity (password login allowed)
--   'google'   → account exists but only via OAuth (e.g. Google)
create or replace function public.email_auth_status(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_has_password boolean;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user_id is null then
    return 'new';
  end if;

  select exists(
    select 1 from auth.identities
    where user_id = v_user_id and provider = 'email'
  ) into v_has_password;

  return case when v_has_password then 'password' else 'google' end;
end;
$$;

revoke all on function public.email_auth_status(text) from public, anon, authenticated;
grant execute on function public.email_auth_status(text) to service_role;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (project `umwtegoeewjmxxlihgtm`, name `email_auth_status`) using the SQL above, or paste it into the Supabase SQL editor.

- [ ] **Step 3: Verify against real data**

Run these via Supabase MCP `execute_sql`:

```sql
select public.email_auth_status('cliphy-mobile-signup-test@example.com'); -- expect 'password'
select public.email_auth_status('suzikang17@gmail.com');                 -- expect 'google'
select public.email_auth_status('definitely-not-a-user@example.com');    -- expect 'new'
```

Expected: `password`, `google`, `new` respectively.

- [ ] **Step 4: Commit**

```bash
git add apps/server/supabase/migrations/011_email_auth_status.sql
git commit -m "add email_auth_status db function for email-first auth"
```

---

## Task 2: Shared types + email validator

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/utils.ts`

- [ ] **Step 1: Add types**

Append to `packages/shared/src/types.ts`:

```ts
export type EmailAuthStatus = "new" | "password" | "google";

export interface CheckEmailResponse {
  status: EmailAuthStatus;
}
```

- [ ] **Step 2: Add `isValidEmail`**

Append to `packages/shared/src/utils.ts`:

```ts
/** Lightweight email syntax check (not RFC-exhaustive; good enough for UX gating). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
```

- [ ] **Step 3: Typecheck shared**

Run: `pnpm --filter @cliphy/shared build` (or `pnpm -w typecheck` if defined)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/utils.ts
git commit -m "add EmailAuthStatus type and isValidEmail helper to shared"
```

---

## Task 3: Rate-limit helper (TDD)

**Files:**

- Create: `apps/server/src/lib/rateLimit.ts`
- Test: `apps/server/src/lib/__tests__/rateLimit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/lib/__tests__/rateLimit.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, __resetRateLimit } from "../rateLimit.js";

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimit();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 1000)).toBe(true);
    expect(checkRateLimit("k", 3, 1000)).toBe(false);
  });

  it("resets after the window", () => {
    expect(checkRateLimit("k", 1, 1000)).toBe(true);
    expect(checkRateLimit("k", 1, 1000)).toBe(false);
    vi.setSystemTime(1001);
    expect(checkRateLimit("k", 1, 1000)).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", 1, 1000)).toBe(true);
    expect(checkRateLimit("b", 1, 1000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cliphy/server test:unit -- rateLimit`
Expected: FAIL — cannot import `../rateLimit.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/server/src/lib/rateLimit.ts
// Best-effort, in-memory per-key token window. NOTE: on Vercel serverless this
// Map is per-instance, so it is a mitigation, not a guarantee. See spec §Security.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Test-only: clear all buckets. */
export function __resetRateLimit(): void {
  buckets.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cliphy/server test:unit -- rateLimit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/rateLimit.ts apps/server/src/lib/__tests__/rateLimit.test.ts
git commit -m "add best-effort in-memory rate limiter"
```

---

## Task 4: `POST /api/auth/check-email` endpoint (TDD)

**Files:**

- Modify: `apps/server/src/routes/auth.ts`
- Test: `apps/server/src/routes/__tests__/checkEmail.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror the supabase-mock style of `apps/server/src/routes/__tests__/queue.test.ts` (chainable proxy with `rpc`). The mock's `rpc` must resolve `{ data, error }`.

```ts
// apps/server/src/routes/__tests__/checkEmail.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

let rpcResult: { data: unknown; error: unknown } = { data: "new", error: null };

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async () => rpcResult),
  },
}));

vi.mock("../../lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn(() => true),
}));

import { authRoutes } from "../auth.js";
import { checkRateLimit } from "../../lib/rateLimit.js";

function app() {
  const a = new Hono<AppEnv>();
  a.route("/auth", authRoutes);
  return a;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return app().request("/auth/check-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/check-email", () => {
  beforeEach(() => {
    rpcResult = { data: "new", error: null };
    vi.mocked(checkRateLimit).mockReturnValue(true);
  });

  it("returns the status from the rpc", async () => {
    rpcResult = { data: "password", error: null };
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "password" });
  });

  it("returns 400 for a malformed email", async () => {
    const res = await post({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(429);
  });

  it("returns 500 when the rpc errors", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cliphy/server test:unit -- checkEmail`
Expected: FAIL — route `/auth/check-email` returns 404.

- [ ] **Step 3: Implement the endpoint**

Add imports at the top of `apps/server/src/routes/auth.ts`:

```ts
import { isValidEmail, type EmailAuthStatus } from "@cliphy/shared";
import { checkRateLimit } from "../lib/rateLimit.js";
```

Add this route to `authRoutes` (place it before the default export / after the existing `/me` route):

```ts
// POST /check-email — email-first flow: classify an email (no auth required).
authRoutes.post("/check-email", async (c) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(`check-email:${ip}`, 10, 60_000)) {
    return c.json({ error: "Too many requests" }, 429);
  }

  let body: { email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return c.json({ error: "Valid email required" }, 400);
  }

  const { data, error } = await supabase.rpc("email_auth_status", { p_email: email });
  if (error) {
    return c.json({ error: "Lookup failed" }, 500);
  }

  return c.json({ status: data as EmailAuthStatus });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cliphy/server test:unit -- checkEmail`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/auth.ts apps/server/src/routes/__tests__/checkEmail.test.ts
git commit -m "add POST /auth/check-email endpoint"
```

---

## Task 5: Mobile API + auth helpers

**Files:**

- Modify: `apps/mobile/lib/api.ts`
- Modify: `apps/mobile/lib/auth.ts`

- [ ] **Step 1: Add `checkEmail` to `lib/api.ts`**

`checkEmail` is **pre-auth** — it must NOT go through `apiFetch` (which requires a token). Add near the other exports:

```ts
import type { CheckEmailResponse } from "@cliphy/shared";

// Auth (pre-login, no token)
export async function checkEmail(email: string): Promise<CheckEmailResponse> {
  const res = await fetch(`${API_URL}/api/auth/check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) throw new Error("Too many attempts — try again in a moment.");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Add reset/update helpers to `lib/auth.ts`**

Add a reset redirect URI next to the existing `redirectUri`:

```ts
const resetRedirectUri = AuthSession.makeRedirectUri({
  scheme: "com.cliphy.app",
  path: "reset",
});
```

Add these exports:

```ts
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: resetRedirectUri,
  });
  if (error) throw error;
}

export async function exchangeRecoveryCode(code: string) {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/api.ts apps/mobile/lib/auth.ts
git commit -m "add checkEmail + password reset helpers (mobile)"
```

---

## Task 6: Rewrite login into a two-step wizard

**Files:**

- Rewrite: `apps/mobile/app/(auth)/login.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  useColorScheme,
} from "react-native";
import { Logo } from "../../components/Logo";
import { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } from "../../lib/auth";
import { checkEmail } from "../../lib/api";
import { brutalShadowSm } from "../../lib/theme";
import { colors, neon, isValidEmail, type EmailAuthStatus } from "@cliphy/shared";

type Step = "email" | "credentials";

function humanizeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Incorrect password.";
  if (/already registered/i.test(message)) return "That email is already registered.";
  return message;
}

export default function LoginScreen() {
  const [step, setStep] = useState<Step>("email");
  const [status, setStatus] = useState<EmailAuthStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDark = useColorScheme() === "dark";
  const placeholderColor = isDark ? colors.dark.textMuted : colors.light.textMuted;

  const normalizedEmail = () => email.trim().toLowerCase();

  async function handleContinueEmail() {
    const e = normalizedEmail();
    if (!isValidEmail(e)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await checkEmail(e);
      setStatus(res.status);
      setStep("credentials");
    } catch {
      // Endpoint unavailable — degrade gracefully to a password attempt so
      // existing users are never blocked from logging in.
      setStatus("password");
      setStep("credentials");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCredentials() {
    setError(null);
    if (status === "new") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
    } else if (!password) {
      setError("Enter your password.");
      return;
    }
    setLoading(true);
    try {
      if (status === "new") {
        await signUpWithEmail(normalizedEmail(), password);
      } else {
        await signInWithEmail(normalizedEmail(), password);
      }
      // Successful auth flips the session; _layout.tsx routes into (tabs).
    } catch (err: unknown) {
      setError(err instanceof Error ? humanizeAuthError(err.message) : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "OAuth cancelled") setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    try {
      await resetPassword(normalizedEmail());
      Alert.alert("Check your email", "We sent you a link to reset your password.");
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Couldn't send reset email.");
    }
  }

  function editEmail() {
    setStep("email");
    setStatus(null);
    setPassword("");
    setConfirm("");
    setError(null);
  }

  const inputClass =
    "px-4 py-3.5 text-base border-2 border-black dark:border-[#505050] rounded-lg bg-[#f3f4f6] dark:bg-[#333333] text-[#111827] dark:text-white";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-white dark:bg-[#1e1e1e]"
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-10">
          <Logo size={64} />
          <Text
            className="text-2xl font-bold mt-3 text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Cliphy
          </Text>
          <Text
            className="text-sm text-[#6b7280] dark:text-[#9ca3af] mt-1"
            style={{ fontFamily: "DMSans" }}
          >
            YouTube summaries, instantly
          </Text>
        </View>

        {step === "credentials" && (
          <Pressable onPress={editEmail} className="mb-3 flex-row items-center gap-1">
            <Text className="text-sm" style={{ color: neon[600], fontFamily: "DMSans" }}>
              ← {normalizedEmail()}
            </Text>
          </Pressable>
        )}

        {step === "email" && (
          <View className="gap-3 mb-4">
            <TextInput
              className={inputClass}
              style={{ fontFamily: "DMSans" }}
              placeholder="Email"
              placeholderTextColor={placeholderColor}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={handleContinueEmail}
              accessibilityLabel="Email address"
            />
          </View>
        )}

        {step === "credentials" && status !== "google" && (
          <View className="gap-3 mb-4">
            <TextInput
              className={inputClass}
              style={{ fontFamily: "DMSans" }}
              placeholder="Password"
              placeholderTextColor={placeholderColor}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              autoComplete={status === "new" ? "new-password" : "current-password"}
              returnKeyType={status === "new" ? "next" : "go"}
              onSubmitEditing={status === "new" ? undefined : handleSubmitCredentials}
              accessibilityLabel="Password"
            />
            {status === "new" && (
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="Confirm password"
                placeholderTextColor={placeholderColor}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmitCredentials}
                accessibilityLabel="Confirm password"
              />
            )}
          </View>
        )}

        {status === "google" && step === "credentials" && (
          <Text
            className="text-sm text-[#6b7280] dark:text-[#9ca3af] mb-4"
            style={{ fontFamily: "DMSans" }}
          >
            This account uses Google sign-in. Continue with Google below.
          </Text>
        )}

        {error && (
          <Text className="text-sm text-red-600 mb-3" style={{ fontFamily: "DMSans" }}>
            {error}
          </Text>
        )}

        {/* Primary action */}
        {status !== "google" && (
          <Pressable
            onPress={step === "email" ? handleContinueEmail : handleSubmitCredentials}
            disabled={loading}
            className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg items-center mb-3"
            style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
          >
            <Text className="text-white font-bold text-base" style={{ fontFamily: "DMSans" }}>
              {loading
                ? "Please wait…"
                : step === "email"
                  ? "Continue"
                  : status === "new"
                    ? "Create Account"
                    : "Log In"}
            </Text>
          </Pressable>
        )}

        {step === "credentials" && status === "password" && (
          <Pressable onPress={handleForgot} className="mb-3">
            <Text
              className="text-center text-sm"
              style={{ color: neon[600], fontFamily: "DMSans" }}
            >
              Forgot password?
            </Text>
          </Pressable>
        )}

        {/* Google option: on the email step, or when the account is Google-only */}
        {(step === "email" || status === "google") && (
          <>
            <View className="flex-row items-center my-6">
              <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
              <Text className="mx-3 text-xs text-[#6b7280]">or</Text>
              <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
            </View>
            <Pressable
              onPress={handleGoogle}
              disabled={loading}
              className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#333333] items-center flex-row justify-center gap-2"
              style={brutalShadowSm()}
            >
              <Text
                className="font-bold text-base text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans" }}
              >
                Continue with Google
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd apps/mobile && npx eslint "app/(auth)/login.tsx"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(auth\)/login.tsx
git commit -m "rebuild login as email-first two-step wizard"
```

---

## Task 7: Password-reset screen + deep link

**Files:**

- Create: `apps/mobile/app/(auth)/reset.tsx`
- Supabase config (manual): add redirect URL

- [ ] **Step 1: Allowlist the reset redirect URL in Supabase**

In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add:

```
com.cliphy.app://reset
```

(Without this, `resetPasswordForEmail` redirects are rejected.)

- [ ] **Step 2: Create `app/(auth)/reset.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Logo } from "../../components/Logo";
import { exchangeRecoveryCode, updatePassword } from "../../lib/auth";
import { brutalShadowSm } from "../../lib/theme";
import { colors, neon } from "@cliphy/shared";

export default function ResetScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const isDark = useColorScheme() === "dark";
  const placeholderColor = isDark ? colors.dark.textMuted : colors.light.textMuted;

  const [exchanging, setExchanging] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!code) {
        setError("This reset link is invalid or has expired.");
        setExchanging(false);
        return;
      }
      try {
        await exchangeRecoveryCode(code);
        setReady(true);
      } catch {
        setError("This reset link is invalid or has expired.");
      } finally {
        setExchanging(false);
      }
    })();
  }, [code]);

  async function handleSave() {
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      // Recovery session is now a full session; _layout routes into (tabs).
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "px-4 py-3.5 text-base border-2 border-black dark:border-[#505050] rounded-lg bg-[#f3f4f6] dark:bg-[#333333] text-[#111827] dark:text-white";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-white dark:bg-[#1e1e1e]"
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-10">
          <Logo size={64} />
          <Text
            className="text-2xl font-bold mt-3 text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Set a new password
          </Text>
        </View>

        {exchanging ? (
          <ActivityIndicator color={neon[600]} />
        ) : ready ? (
          <>
            <View className="gap-3 mb-4">
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="New password"
                placeholderTextColor={placeholderColor}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                accessibilityLabel="New password"
              />
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="Confirm new password"
                placeholderTextColor={placeholderColor}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSave}
                accessibilityLabel="Confirm new password"
              />
            </View>
            {error && (
              <Text className="text-sm text-red-600 mb-3" style={{ fontFamily: "DMSans" }}>
                {error}
              </Text>
            )}
            <Pressable
              onPress={handleSave}
              disabled={loading}
              className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg items-center"
              style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
            >
              <Text className="text-white font-bold text-base" style={{ fontFamily: "DMSans" }}>
                {loading ? "Saving…" : "Save password"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="text-sm text-red-600 mb-4" style={{ fontFamily: "DMSans" }}>
              {error}
            </Text>
            <Pressable onPress={() => router.replace("/(auth)/login")}>
              <Text
                className="text-center text-sm"
                style={{ color: neon[600], fontFamily: "DMSans" }}
              >
                Back to login
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/mobile && npx tsc --noEmit -p tsconfig.json && npx eslint "app/(auth)/reset.tsx"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(auth\)/reset.tsx
git commit -m "add password reset screen with deep-link recovery"
```

---

## Task 8: End-to-end verification on iOS Simulator

**Files:** none (verification only)

- [ ] **Step 1: Rebuild + launch the dev client**

Run: `cd apps/mobile && npx expo start --dev-client` (reuse the running Metro if present), then launch on the iPhone 16 Pro simulator.

- [ ] **Step 2: Verify the three Screen-2 branches**

- New email (e.g. `cliphy-newuser-test@example.com`) → Continue → **password + confirm** shown → Create Account → lands in app.
- Existing password email (`cliphy-mobile-signup-test@example.com`) → Continue → **single password** field + Forgot password → wrong password shows "Incorrect password." → correct password logs in.
- Google-only email (`suzikang17@gmail.com`) → Continue → **"This account uses Google sign-in"** + Continue with Google (no password field).

Expected: each branch renders as described; capture a screenshot of each.

- [ ] **Step 3: Verify edit-email back action**

From any credentials screen, tap **← email** → returns to the email step with the email still populated.

- [ ] **Step 4: Verify forgot-password round trip**

On the password branch, tap **Forgot password?** → "Check your email" alert. In Supabase Dashboard (or the inbox), open the reset link → app opens to **Set a new password** → enter matching passwords → Save → lands in app. (If testing without a real inbox, trigger the deep link manually: `xcrun simctl openurl booted "com.cliphy.app://reset?code=<code>"` using a code from Supabase logs.)

- [ ] **Step 5: Clean up test data**

Remove any throwaway accounts/summaries created during verification via Supabase MCP `execute_sql`.

- [ ] **Step 6: Final checks + commit (if any fixes were needed)**

Run: `pnpm --filter @cliphy/server test:unit && cd apps/mobile && npx tsc --noEmit -p tsconfig.json && npx eslint app`
Expected: all green. Commit any verification-driven fixes.

---

## Self-Review Notes

- **Spec coverage:** email-first 3-way branch (Tasks 4, 6); Google nudge (Task 6 `status === "google"`); two-step wizard (Task 6); backend endpoint + DB function (Tasks 1, 4); enumeration mitigation (Task 3 limiter, wired in Task 4); forgot-password reset (Tasks 5, 7); fallback on endpoint failure (Task 6 `handleContinueEmail` catch); error handling (Task 6 `humanizeAuthError`, inline errors); testing (Tasks 3, 4 unit; Task 8 manual). All spec sections mapped.
- **Type consistency:** `EmailAuthStatus` (`new`/`password`/`google`) defined in Task 2, consumed identically in Tasks 4, 6; `CheckEmailResponse` defined Task 2, used Task 5; `checkEmail`/`resetPassword`/`exchangeRecoveryCode`/`updatePassword` signatures defined Task 5 and consumed unchanged in Tasks 6, 7.
- **No placeholders:** every code/test step contains full content.
