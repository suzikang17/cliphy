---
date: 2026-02-17
title: "SELECT-only RLS — all writes via service_role"
category: Tech
revisit: false
---

# SELECT-only RLS — all writes via service_role

**Date:** 2026-02-17 · **Category:** Tech · **Revisit?** no

## Why this choice

Security review found critical issues with client-side write policies: users could escalate plan to pro, reset rate limit counters, spoof stripe_customer_id. Removing all write policies eliminates the entire class of privilege escalation attacks.

## Options considered

1. Full CRUD RLS policies (users can INSERT/UPDATE their own rows)
2. SELECT-only policies, backend handles all writes via service_role

## Tradeoffs

Every write must go through the backend API — no direct Supabase client writes from extension. Adds a network hop but worth it for security.
