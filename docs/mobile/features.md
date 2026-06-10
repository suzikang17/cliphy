# Mobile feature set

What the app does today, with file pointers. (As of 2026-06-10.)

## Auth — `app/(auth)/`, `lib/auth.ts`

- **Email + password**, two-step flow: enter email → `POST /api/auth/check-email` classifies it (`new` / `password` / `google`) → show the right credentials UI (sign-up with confirm, login with forgot-password, or "use Google" notice). If check-email is down, degrades to a plain password attempt so existing users are never locked out.
- **Google OAuth** via `expo-auth-session` + `WebBrowser.openAuthSessionAsync`, PKCE code exchange (`exchangeCodeForSession`).
- **Password reset**: email link deep-links to `(auth)/reset?code=…` → recovery code exchanged → new password form. The auth gate deliberately doesn't auto-enter the app while on this screen.
- Session persists in AsyncStorage; auto-refresh; sign-out in Settings.

## Queue tab — `app/(tabs)/index.tsx`

- Lists the user's summaries/queue items (`GET /api/queue`) as **QueueCard**s: thumbnail (`i.ytimg.com/vi/<id>/mqdefault.jpg`), title, channel, up to 2 tags, and a **corner status dot** (gray=queued, neon+pulse=summarizing, green=done, red=failed). Completed cards open the summary; others give a light haptic.
- **Live updates** via Supabase Realtime (`postgres_changes` on `summaries`, filtered by user) — INSERT/UPDATE/DELETE patch the list with no polling, so a video flips queued → summarizing → done in place.
- Pull-to-refresh, skeleton loaders, friendly error state with retry.
- **UsageBar** (`components/UsageBar.tsx`) pinned at bottom: monthly usage vs plan limit.

## Adding videos

Three entry points, all landing on `POST /api/queue`:

1. **Share sheet** ("Share to Cliphy") from YouTube or any app — `expo-share-intent`, handled in `_layout.tsx`; works from cold launch via `+native-intent.tsx`. Success/duplicate/limit alerts via `lib/queueError.ts`.
2. **Clipboard detection** — on app foreground, if the clipboard holds a YouTube URL (and it's not the last one offered), a banner slides up: _"YouTube link detected — Add / Skip"_, auto-dismisses after 8s. (`lib/clipboard.ts` + banner logic in the Queue screen.)
3. _(Implicit)_ anything queued from the extension/web appears via Realtime.

## Summary detail — `app/summary/[id].tsx`

- Pushed screen with custom chevron-back header **and** native swipe-back.
- Renders the structured summary via `components/SummaryContent.tsx` (shared layout with sections/key points/timestamps); skeleton while loading; link out to the YouTube video.

## Subscriptions tab — `app/(tabs)/subscriptions.tsx` (Pro)

- Manage auto-subscriptions: paste a YouTube **channel / playlist** URL (type inferred client-side), or one-tap **Watch Later / Liked Videos** sources.
- Watch Later/Liked require a **Google account connection** — connect/disconnect flow via `/api/auth/google` (opens OAuth in in-app browser), status shown inline.
- Per-subscription enable/disable switch and delete; pull-to-refresh; gated behind Pro (`UpgradePrompt` for free users).

## Settings tab — `app/(tabs)/settings.tsx`

- Signed-in-as card, **Upgrade to Pro** (free) or **Manage Subscription** → Stripe checkout/portal in an in-app browser, sign out.

## Push notifications — `lib/notifications.ts`

- Prompted after sign-in; Expo push token registered with `/api/devices`. Summary-completed pushes deep-link straight to the summary screen on tap.

## Design system

- **Neobrutalist**: 2px black borders, hard offset shadows (`brutalShadow*` in `lib/theme.ts`), neon accent (`neon[600]` from `@cliphy/shared`), DM Sans everywhere.
- Full **dark mode** via `useColorScheme` + NativeWind `dark:` classes; theme tokens shared with web through `@cliphy/shared` `colors`.
- Accessibility: roles/labels/hints on interactive elements; status conveyed in `accessibilityLabel` (the corner dot is decorative for VoiceOver users).

## Not in the app (yet)

- Tag browsing/filtering, summary search, chat-with-video, translations — exist server-side/web; mobile only displays tags on cards.
- Queue item delete/retry — `lib/api.ts` has `deleteQueueItem`/`retryQueueItem` wired, but no UI calls them yet.
- Android: configured (package, adaptive icon, intent filters) but untested/unbuilt — iOS is the target platform so far.
