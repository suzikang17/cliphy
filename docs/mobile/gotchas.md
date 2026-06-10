# Mobile gotchas

Hard-won, easy-to-rediscover-the-hard-way. Each entry: what bites, why, where the fix lives.

## Runtime / environment

- **Expo Go cannot run this app.** `expo-share-intent`, `expo-notifications`, `expo-secure-store`, `expo-updates` are native modules → a **dev client build** is required (`eas build --profile development`). `pnpm dev:mobile` assumes one is installed.
- **`polyfills.js` must stay the first import in `app/_layout.tsx`.** Hermes lacks `SharedArrayBuffer` (some Supabase deps reference it) and `crypto.subtle` (Supabase PKCE needs SHA-256 for the code challenge). The shim maps `crypto.subtle.digest`/`getRandomValues` onto `expo-crypto`. Remove or reorder it and **auth breaks** with opaque crypto errors.
- **`EXPO_PUBLIC_*` env vars are baked at build/publish time**, not runtime. Changing `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SUPABASE_*` requires a rebuild (or a new OTA update). Same trap as `VITE_*` in the extension.
- **Identifier mismatch is intentional but confusing:** URL scheme & Android package are `com.cliphy.app`; the **iOS bundleIdentifier is `com.cliphy.ios`**. Anything App Store/ASC-related (eas submit, provisioning) keys off `com.cliphy.ios`; deep links and `makeRedirectUri` key off the scheme.

## Share-to-Cliphy (the triple-queue saga, 2026-06-09)

The same video once queued **3× from one share**. Two stacked bugs — both fixes must stay:

1. **Client re-entry** (`app/_layout.tsx`): `useShareIntent`'s payload stays populated until `resetShareIntent()`. The original code reset it in `.finally()` _after_ the async enqueue — re-renders during the in-flight request re-fired the effect 2-3×. Fix: **snapshot the text + reset synchronously before the async call**, plus a `processingShareRef` guard. Don't "simplify" the reset back into the promise chain.
2. **Server TOCTOU** (`apps/server/src/routes/queue.ts`): the duplicate SELECT-then-INSERT check let concurrent requests all pass. Fix: windowed atomic dedup — `dedup_bucket` column + partial unique index, `23505` → `409 DUPLICATE` (**ADR 0039**, migration `014`). The window (`DEDUP_WINDOW_SECONDS = 60`) deliberately doesn't block re-summarizing later.
3. **Cold-launch Unmatched Route** (`app/+native-intent.tsx`): sharing while the app is killed launches it at `com.cliphy.app://dataUrl=com.cliphy.appShareKey`; expo-router can't match that path. `redirectSystemPath` must intercept it (match on `getShareExtensionKey()`) and return `/`. Delete this file and **cold-launch sharing breaks entirely** — warm-app sharing still works, which makes the regression easy to miss in testing. Test shares with the app fully swiped away.

## Auth

- **Google OAuth needs `skipBrowserRedirect: true` and a manual PKCE exchange.** `openAuthSessionAsync` returns the callback URL; pass the **bare `code` query param** (not the full URL) to `exchangeCodeForSession` (`lib/auth.ts`).
- **`detectSessionInUrl: false`** in the Supabase client — RN has no location bar; leaving it on causes weirdness.
- **Password-recovery sessions look like real sessions.** After tapping a reset link, Supabase creates a session _before_ the new password is set. The auth gate's `onReset` check (`_layout.tsx`) is what stops users being bounced into the app mid-reset — keep it when refactoring the gate.
- **The auth gate must only use `router.replace`.** The root layout is a `<Stack>` (for swipe-back); a `push` from the gate would put login/tabs in back-history and let users swipe back across the auth boundary.

## Navigation

- **Root layout is `<Stack>`, not `<Slot/>`** — deliberate, for native swipe-back on `summary/[id]`. If a screen ever shouldn't be swipe-dismissable, set `gestureEnabled: false` on that screen, don't revert the root.
- **Adding a route file changes the route manifest** — fast-refresh isn't enough; restart Metro (`--clear` if it acts haunted).

## Realtime & data

- Queue live updates rely on Supabase Realtime `postgres_changes` for `summaries` — the table must stay in the Realtime publication server-side; if live updates die silently, check that first (the app falls back to looking merely stale, pull-to-refresh still works).
- Clipboard banner dedupes against the **last offered URL** (`lastClipboardUrl` ref), not history — copying the same link twice in a row only prompts once per foreground.

## Push

- **Physical device only** — simulators return no token (`Device.isDevice` guard).
- Token fetch needs the **EAS projectId** (read from `Constants.expoConfig.extra.eas.projectId`) — breaks in environments where that's absent.

## OTA / builds

- **`expo-updates` is inert in the dev client** — local testing is unaffected by OTA config. But OTA only reaches binaries **built with `expo-updates` embedded**: builds from before 2026-06-09 can never receive OTA; one new native build is the entry fee.
- **`runtimeVersion: { policy: "fingerprint" }`**: changing any native dependency or `app.json` plugin config changes the fingerprint → OTA updates stop applying to old builds (by design, prevents JS/native mismatch crashes). If an `eas update` "isn't arriving", check the fingerprint changed and ship a build instead.
