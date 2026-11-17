---
type: decision
title: "Mac window: the phone app built for the web, served and signed for by the Mac app"
date: 2026-11-17
category: Capture
revisit: true
---

## Why this choice

The owner wants the Mac app to be a full app (Chat, Projects), not only the helper's setup window. The phone app already has every screen, so the Mac window loads those screens instead of a second set written for the desktop.

- `apps/mobile` is exported for the web (`expo export --platform web`) into `apps/mac-app/web` by the Mac build.
- The Mac app serves it at `app://cliphy/` (`src/appServer.ts`). Calls to `/api/` on that address are passed on to Cliphy with the Mac's own key, which pairing already gave it. The page never holds the key and has no sign-in.
- In the phone code, `lib/desktop.ts` (`DESKTOP = Platform.OS === "web"`) switches off sign-in, push, reminders and timezone reporting, and `DesktopShell` puts a side nav beside the screens in place of the tab bar.

## Options considered

- **A separate desktop UI in the Electron window.** Full control over layout; every screen written and kept in step twice.
- **Host the web build (e.g. on Vercel) and load the URL.** Updates without rebuilding the Mac app. Needs a sign-in in the window and a CORS entry, and puts the app on a public address. Worth revisiting once the Mac app has auto-update or is built often.
- **Bundle the web build and proxy API calls in the main process (chosen).** No sign-in, no CORS change, the key stays out of the page, works from source with one build command.

## Tradeoffs

- A screen change reaches the Mac only when the Mac app is rebuilt (`start` does it from source); the phone gets it over the air.
- The web build is treated as "the Mac window" everywhere. A browser version for other people would need that split apart.
- Screens are phone layouts in a 760px column. Camera, share sheet and notifications have no desktop form yet; the Library is not in the Mac nav.
- `react-dom` and `react-native-web` were added to `apps/mobile`; the native fingerprint was checked before and after and did not change, so over-the-air updates still reach the installed phone build.
