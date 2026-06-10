---
title: "Test full payment flow in Stripe test mode"
status: done
owner: none
type: feature
completed: 2026-03-02
---

# Test full payment flow in Stripe test mode

Tested full checkout flow in Stripe test mode (card 4242...). Verified webhook fires and updates DB (plan=pro, subscription_status=active). Tested billing portal for subscription management. Debugged 4 production issues: missing API_URL env var, /api prefix on URLs, trailing newline in env vars, live vs test price ID. Set up Supabase MCP for direct DB access during testing.

_Migrated from task-archive.md (CLIP-20, target Day 10)._
