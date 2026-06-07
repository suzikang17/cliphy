---
date: 2026-02-17
title: "Use Web Application OAuth type for Google sign-in (not Chrome Extension type)"
category: Tech
revisit: false
---

# Use Web Application OAuth type for Google sign-in (not Chrome Extension type)

**Date:** 2026-02-17 · **Category:** Tech · **Revisit?** no

## Why this choice

Auth flow goes through Supabase's server-side redirect. Supabase manages sessions, tokens, refresh, and user records automatically. RLS policies work out of the box. Chrome Extension type uses chrome.identity API which bypasses Supabase entirely — you'd manage tokens yourself and lose all Supabase Auth integration.

## Options considered

Web Application OAuth (redirect via Supabase), Chrome Extension OAuth (chrome.identity API)

## Tradeoffs

Web Application: slightly worse UX (opens tab for sign-in instead of native popup), but gets full Supabase Auth integration (sessions, user records, RLS, token refresh). Chrome Extension type: smoother popup-based UX, but no Supabase integration — manual token management, manual user record creation, custom auth middleware for everything. Also Chrome-only, no web app portability.
