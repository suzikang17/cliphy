---
title: "Fix Google OAuth redirect on mobile"
status: open
owner: human
effort: small
type: bug
platform: "mobile"
---

# Fix Google OAuth redirect on mobile

After Google sign-in completes, the in-app browser gets stuck on an empty page instead of redirecting back to the app. Need to: 1) Add com.cliphy.app://auth/callback to Supabase Dashboard redirect URLs, 2) Verify expo-web-browser closes on redirect, 3) Check if Supabase OAuth flow needs skipBrowserRedirect or different redirectTo config for mobile.

_Migrated from ROADMAP.md (CLIP-81, was 'To Do')._
