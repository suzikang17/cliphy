---
title: "Stripe integration (checkout, portal, webhooks)"
status: done
owner: none
type: feature
completed: 2026-03-02
---

# Stripe integration (checkout, portal, webhooks)

Server: checkout session with client_reference_id, env-based price ID, portal session. Routes: POST /checkout (create/lookup Stripe customer, create session), POST /portal, GET /success, GET /cancel. Extension: openCheckout() helper with tab listener for success callback, auto-refresh on plan change via visibilitychange. Pro badge opens billing portal. 9 unit tests. Commits: 7fd5627, 6018569

_Migrated from task-archive.md (CLIP-18, target Day 10)._
