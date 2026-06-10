---
title: "Email/Password Auth Implementation Plan"
date: 2026-03-26
---

# Email/Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password authentication as an alternative to Google OAuth in the extension sidepanel.

**Architecture:** Add `signUpWithEmail` and `signInWithEmail` functions to `lib/auth.ts` that call Supabase REST endpoints directly. Update the sidepanel login screen with email/password form fields above the existing Google button. Add a `SETUP_REALTIME` message type so the sidepanel can trigger realtime subscription setup after email auth.

**Tech Stack:** Supabase Auth REST API, React, TypeScript, WXT

**Spec:** `docs/superpowers/specs/2026-03-26-email-password-auth-design.md`

---

### Task 1: Add SETUP_REALTIME message type

**Files:**

- Modify: `packages/shared/src/messages.ts`

- [ ] **Step 1: Add the message interface and union member**

In `packages/shared/src/messages.ts`, add after the `SignOutMessage` interface:

```typescript
export interface SetupRealtimeMessage {
  type: "SETUP_REALTIME";
}
```

And add `SetupRealtimeMessage` to the `ExtensionMessage` union:

```typescript
export type ExtensionMessage =
  | VideoDetectedMessage
  | GetVideoInfoMessage
  | AddToQueueMessage
  | SignInMessage
  | SignOutMessage
  | SetupRealtimeMessage
  | SummaryUpdatedMessage
  | SeekVideoMessage;
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @cliphy/shared build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/messages.ts
git commit -m "add SETUP_REALTIME message type for email auth"
```

---

### Task 2: Add SETUP_REALTIME handler in background script

**Files:**

- Modify: `apps/extension/entrypoints/background.ts:153-158`

- [ ] **Step 1: Add the message handler**

In `apps/extension/entrypoints/background.ts`, inside the `switch` statement in `runtime.onMessage`, add a new case after the `SIGN_OUT` case (after line 158):

```typescript
        case "SETUP_REALTIME":
          setupRealtime()
            .then(() => sendResponse({ success: true }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;
```

- [ ] **Step 2: Verify extension builds**

Run: `pnpm --filter extension build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "handle SETUP_REALTIME message in background script"
```

---

### Task 3: Add email auth functions to lib/auth.ts

**Files:**

- Modify: `apps/extension/lib/auth.ts`

- [ ] **Step 1: Add signUpWithEmail function**

Add after the existing `signIn()` function (after line 59) in `apps/extension/lib/auth.ts`:

```typescript
/**
 * Sign up with email and password via Supabase REST API.
 * Can be called directly from the sidepanel (no background script needed).
 */
export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.msg || data?.error_description || data?.message;
    if (res.status === 422 && msg?.includes("already been registered")) {
      throw new Error("An account with this email already exists. Try signing in.");
    }
    throw new Error(msg || "Sign up failed");
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Sign up failed — no tokens received");
  }

  await setTokens(data.access_token, data.refresh_token);
}

/**
 * Sign in with email and password via Supabase REST API.
 * Can be called directly from the sidepanel (no background script needed).
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.msg || data?.error_description || data?.message;
    if (res.status === 400) {
      throw new Error("Invalid email or password");
    }
    throw new Error(msg || "Sign in failed");
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Sign in failed — no tokens received");
  }

  await setTokens(data.access_token, data.refresh_token);
}
```

- [ ] **Step 2: Verify extension builds**

Run: `pnpm --filter extension build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/lib/auth.ts
git commit -m "add signUpWithEmail and signInWithEmail auth functions"
```

---

### Task 4: Update sidepanel login screen with email/password form

**Files:**

- Modify: `apps/extension/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: Add imports and state**

In `apps/extension/entrypoints/sidepanel/App.tsx`, update the auth import (line 28):

```typescript
import {
  getAccessToken,
  getUserIdFromToken,
  signUpWithEmail,
  signInWithEmail,
} from "../../lib/auth";
```

Add state variables inside the `App` component, near the other `useState` declarations:

```typescript
const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
const [emailInput, setEmailInput] = useState("");
const [passwordInput, setPasswordInput] = useState("");
const [emailLoading, setEmailLoading] = useState(false);
```

- [ ] **Step 2: Add email auth handler**

Add after the existing `handleSignIn` function (after line 344):

```typescript
async function handleEmailAuth(e: React.FormEvent) {
  e.preventDefault();
  setError(null);
  setEmailLoading(true);
  try {
    if (authMode === "signup") {
      await signUpWithEmail(emailInput, passwordInput);
    } else {
      await signInWithEmail(emailInput, passwordInput);
    }
    // Trigger realtime subscription in background
    browser.runtime.sendMessage({ type: "SETUP_REALTIME" }).catch(() => {});
    setLoading(true);
    setEmailLoading(false);
    await init();
  } catch (err) {
    setEmailLoading(false);
    setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
  }
}
```

- [ ] **Step 3: Replace login screen UI**

Replace the login screen section (lines 600-655, the `if (!user)` block) with:

```tsx
if (!user) {
  return (
    <div className="flex flex-col h-screen">
      {topBar}
      <div className="p-4">
        <div className="text-center mb-4 mt-2">
          <h2 className="text-xl font-extrabold m-0 flex items-center justify-center gap-1.5">
            <Logo size={28} /> Cliphy
          </h2>
          <p className="text-sm text-(--color-text-muted) m-0 mt-1">YouTube summaries in seconds</p>
        </div>

        <div className="space-y-2.5 mb-6">
          <div className="bg-(--color-accent-surface) rounded-lg p-3 flex items-start gap-3">
            <span className="text-lg shrink-0">&#128203;</span>
            <div>
              <p className="text-sm font-bold m-0">Queue any video</p>
              <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                Add videos while you browse
              </p>
            </div>
          </div>
          <div className="bg-(--color-surface-raised) rounded-lg p-3 flex items-start gap-3">
            <span className="text-lg shrink-0">&#9889;</span>
            <div>
              <p className="text-sm font-bold m-0">AI summary in ~30s</p>
              <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                Skip the fluff, get the insights
              </p>
            </div>
          </div>
          <div className="bg-(--color-surface-raised) rounded-lg p-3 flex items-start gap-3">
            <span className="text-lg shrink-0">&#127919;</span>
            <div>
              <p className="text-sm font-bold m-0">Key points &amp; timestamps</p>
              <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                Jump to what matters most
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-2.5 mb-3">
          <input
            type="email"
            placeholder="Email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-(--color-surface-raised) border-2 border-(--color-border-hard) rounded-lg outline-none focus:border-neon-600"
          />
          <input
            type="password"
            placeholder="Password"
            required
            minLength={6}
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-(--color-surface-raised) border-2 border-(--color-border-hard) rounded-lg outline-none focus:border-neon-600"
          />
          <button
            type="submit"
            disabled={emailLoading}
            className="px-5 py-2.5 text-sm bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal hover:shadow-brutal-hover press-down font-bold cursor-pointer w-full disabled:opacity-50"
          >
            {emailLoading
              ? authMode === "signup"
                ? "Creating account..."
                : "Signing in..."
              : authMode === "signup"
                ? "Sign up"
                : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-center text-(--color-text-muted) m-0 mb-4">
          {authMode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setError(null);
                }}
                className="text-neon-600 font-bold bg-transparent border-none cursor-pointer p-0 text-xs"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signin");
                  setError(null);
                }}
                className="text-neon-600 font-bold bg-transparent border-none cursor-pointer p-0 text-xs"
              >
                Sign in
              </button>
            </>
          )}
        </p>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-(--color-border-soft)" />
          <span className="text-xs text-(--color-text-muted)">or</span>
          <div className="flex-1 h-px bg-(--color-border-soft)" />
        </div>

        <button
          onClick={handleSignIn}
          className="px-5 py-2.5 text-sm bg-(--color-surface-raised) text-(--color-text-primary) border-2 border-(--color-border-hard) rounded-lg shadow-brutal hover:shadow-brutal-hover press-down font-bold cursor-pointer w-full"
        >
          Continue with Google
        </button>
        {error && <p className="text-red-600 text-xs mt-2 text-center">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify extension builds**

Run: `pnpm --filter extension build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/sidepanel/App.tsx
git commit -m "add email/password login form to sidepanel"
```

---

### Task 5: Manual testing

**Files:** None (testing only)

- [ ] **Step 1: Enable email auth in Supabase**

Go to Supabase Dashboard → Authentication → Providers → Email.

- Enable email provider
- Disable "Confirm email"
- Save

- [ ] **Step 2: Build and load extension**

Run: `pnpm dev:extension`

Load unpacked extension from `apps/extension/.output/chrome-mv3` in `chrome://extensions`.

- [ ] **Step 3: Test sign-up flow**

1. Open sidepanel on a YouTube page
2. Enter a test email and password (min 6 chars)
3. Click "Sign up"
4. Verify: account is created, sidepanel shows logged-in state
5. Verify: user appears in Supabase Auth dashboard

- [ ] **Step 4: Test sign-out and sign-in flow**

1. Sign out
2. Switch to "Sign in" mode (should be default)
3. Enter same email and password
4. Click "Sign in"
5. Verify: logged back in, queue and usage load correctly

- [ ] **Step 5: Test error cases**

1. Sign up with an already-registered email → should show "An account with this email already exists. Try signing in."
2. Sign in with wrong password → should show "Invalid email or password"
3. Sign in with non-existent email → should show "Invalid email or password"
4. Submit empty form → browser native validation blocks it
5. Submit password < 6 chars → browser native validation blocks it

- [ ] **Step 6: Test Google OAuth still works**

1. Sign out
2. Click "Continue with Google"
3. Verify: Google OAuth flow works as before

- [ ] **Step 7: Test realtime updates with email auth**

1. Sign in with email/password
2. Add a video to queue
3. Verify: summary status updates appear in real-time (SETUP_REALTIME message triggers subscription)

- [ ] **Step 8: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "verify email/password auth works end-to-end"
```
