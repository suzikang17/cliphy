---
date: 2026-03-03
title: "Use Sentry for error tracking"
category: Tech
revisit: false
---

# Use Sentry for error tracking

**Date:** 2026-03-03 · **Category:** Tech · **Revisit?** no

## Why this choice

Free tier (5k errors/mo), first-party SDKs for Node.js + browser/React, native Discord integration, industry standard. Errors-only mode (tracesSampleRate: 0) keeps quota low.

## Options considered

Sentry, Vercel Monitoring (sunset for Pro), BetterStack, Highlight.io, GlitchTip, Bugsnag

## Tradeoffs

Adds ~70KB to extension bundle. DSN is semi-public. Serverless requires Sentry.flush() adding up to 2s latency on errors only. No performance monitoring on free tier.
