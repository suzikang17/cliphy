---
date: 2026-02-14
title: "Use Supabase for database and auth"
category: Tech
revisit: false
---

# Use Supabase for database and auth

**Date:** 2026-02-14 · **Category:** Tech · **Revisit?** no

## Why this choice

Generous free tier (500MB DB, 50k users). Built-in Google OAuth. PostgreSQL under the hood. Real-time subscriptions if needed later.

## Options considered

Supabase, Firebase, PlanetScale, raw PostgreSQL on Railway

## Tradeoffs

Vendor lock-in. RLS can be tricky. Less flexibility than self-hosted Postgres. Free tier has limits that matter at scale.
