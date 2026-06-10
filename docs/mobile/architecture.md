# Mobile architecture

## Stack

| Layer          | Choice                                                                            | Notes                                                                                 |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Framework      | Expo SDK 55 / React Native 0.83 / React 19.2                                      | New Architecture enabled (`newArchEnabled: true`), Hermes                             |
| Routing        | `expo-router` v55 (file-based)                                                    | Root **Stack** navigator (swipe-back), `Tabs` inside                                  |
| Styling        | NativeWind 4 (Tailwind classes) + inline style for shadows/fonts                  | Neobrutalist look: `border-2 border-black`, `brutalShadowSm()` from `lib/theme.ts`    |
| Fonts          | DM Sans (bundled `.ttf` in `assets/fonts/`, loaded via `useFonts`)                | Applied per-Text with `fontFamily: "DMSans"`                                          |
| Auth/data      | `@supabase/supabase-js` v2 (PKCE) + Cliphy REST API                               | Supabase for auth + Realtime; all product data through `/api/*`                       |
| Shared code    | `@cliphy/shared` (workspace package)                                              | Types, color tokens, `extractVideoId`, constants — same package the web/extension use |
| Native modules | `expo-share-intent`, `expo-notifications`, `expo-secure-store`, `expo-updates`, … | These force a dev build; **Expo Go cannot run the app**                               |
| Workflow       | CNG / managed — `ios/` & `android/` are **gitignored** prebuild output            | All native config lives in `app.json` plugins; EAS regenerates natively at build      |

## Identifiers

| Thing                | Value                                  |
| -------------------- | -------------------------------------- |
| URL scheme           | `com.cliphy.app`                       |
| iOS bundleIdentifier | `com.cliphy.ios`                       |
| Android package      | `com.cliphy.app`                       |
| EAS projectId        | `5af71f4e-b1ca-4cc7-b38d-791e6c965e49` |

(Yes, the iOS bundle id differs from the scheme/Android package — see gotchas.)

## Directory layout

```
apps/mobile/
├── app/                    # expo-router file routes
│   ├── _layout.tsx         # root Stack + auth gate + share-intent + push handlers
│   ├── +native-intent.tsx  # share-extension cold-launch URL → "/" redirect
│   ├── index.tsx           # blank gate screen (auth effect routes away from it)
│   ├── (auth)/             # login.tsx (email+Google), reset.tsx (password recovery)
│   ├── (tabs)/             # index.tsx (Queue), subscriptions.tsx, settings.tsx
│   └── summary/[id].tsx    # summary detail (pushed; swipe-back)
├── lib/
│   ├── api.ts              # typed REST client: bearer auth, 401 refresh+retry, typed errors
│   ├── auth.ts             # Supabase auth helpers (email, Google PKCE, reset)
│   ├── supabase.ts         # client: AsyncStorage persistence, flowType "pkce"
│   ├── notifications.ts    # Expo push: permission, token, register with /api/devices
│   ├── clipboard.ts        # YouTube-URL-in-clipboard detection
│   ├── queueError.ts       # typed API errors → friendly Alerts (incl. upgrade CTAs)
│   └── theme.ts            # light/dark theme tokens + brutal shadows
├── components/             # QueueCard, SummaryContent, Skeleton, EmptyState,
│                           # UsageBar, UpgradePrompt, Logo
├── polyfills.js            # Hermes shims (SharedArrayBuffer, crypto.subtle) — MUST load first
├── app.json                # Expo config: plugins, share-intent rules, updates URL
└── eas.json                # build profiles (development/preview/production) + OTA channels
```

## Navigation & auth gate

The root layout (`app/_layout.tsx`) renders a **`<Stack>`** (`headerShown: false`, `gestureEnabled: true`) — chosen over `<Slot/>` specifically so pushed screens (`summary/[id]`) get the native iOS edge-swipe-back gesture.

Routing is driven by an **auth-gate effect**, not by guards on individual screens:

1. On mount, `supabase.auth.getSession()` resolves the persisted session; `onAuthStateChange` keeps it live.
2. An effect watches `(session, segments)` and corrects location with **`router.replace`** (never `push`):
   - no session & not in `(auth)` → `/(auth)/login`
   - session & in `(auth)` or at root → `/(tabs)`
   - exception: on `(auth)/reset` a _recovery_ session exists but the user hasn't set a new password — the gate must not bounce them into the app (`onReset` check).
3. Because the gate only ever `replace`s, `(tabs)` sits at the **stack root** — swipe-back can't escape the app or land back on login.

`app/index.tsx` is intentionally a blank screen; the gate routes off it before first paint matters.

## Data flow

```
UI screens ──► lib/api.ts ──► EXPO_PUBLIC_API_URL (/api/*, Hono on Vercel)
     ▲              │
     │              └── Authorization: Bearer <supabase access token>
     │                   on 401: refreshSession → retry once → AuthError
     │
     └─◄ Supabase Realtime (postgres_changes on `summaries`, filter user_id)
          → live INSERT/UPDATE/DELETE patches to the Queue list, no polling
```

- **All product reads/writes go through the REST API** (`/api/queue`, `/api/summaries`, `/api/usage`, `/api/billing`, `/api/subscriptions`, `/api/devices`, `/api/auth/google*`). The Supabase client is used directly only for **auth** and **Realtime**.
- `lib/api.ts` converts non-2xx responses into typed errors — `AuthError`, `RateLimitError(limit, plan)`, `ProRequiredError(feature)`, `DuplicateError` — which `lib/queueError.ts` renders as friendly alerts (rate-limit/pro errors include an "Upgrade to Pro" CTA that opens Stripe checkout in an in-app browser).

## Share-to-Cliphy pipeline

The most intricate flow in the app; both halves matter:

1. **OS share sheet → app**: `expo-share-intent` (plugin config in `app.json`: iOS `NSExtensionActivationSupportsWebURLWithMaxCount: 1`, Android `text/*` intent filter).
2. **Cold launch**: the OS opens the app at `com.cliphy.app://dataUrl=com.cliphy.appShareKey`. `app/+native-intent.tsx` intercepts this in `redirectSystemPath` and redirects to `/` — without it, expo-router shows **Unmatched Route**.
3. **Handler** (`_layout.tsx`): `useShareIntent()` exposes the payload; an effect extracts the YouTube URL, **resets the intent synchronously before the async call** and holds a `processingShareRef` re-entry guard (one share = one request — see gotchas for the triple-queue history).
4. **Server backstop**: `POST /api/queue` has windowed atomic dedup (ADR 0039); a stray duplicate gets `409 DUPLICATE` → "Already in your queue" alert.

## Push notifications

- `lib/notifications.ts`: physical-device check → permission prompt → `getExpoPushTokenAsync({ projectId })` → token POSTed to `/api/devices` with platform.
- Registration is triggered from `_layout.tsx` whenever a session appears.
- **Notification tap** → `router.push("/summary/<id>")` via `addNotificationResponseReceivedListener` (summaryId rides in the notification payload).
- The server sends the push when a summary completes (see server docs).
