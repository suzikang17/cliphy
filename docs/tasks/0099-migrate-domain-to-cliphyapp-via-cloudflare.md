---
title: "Migrate domain to cliphy.app via Cloudflare"
status: done
owner: none
type: infra
completed: 2026-04-10
---

# Migrate domain to cliphy.app via Cloudflare

Move from cliphy.vercel.app to cliphy.app. Domain on Namecheap, moving nameservers to Cloudflare. Steps: 1) Add cliphy.app to Cloudflare free plan. 2) Update nameservers in Namecheap to Cloudflare's. 3) Add DNS records in Cloudflare: A @ → 76.76.21.21, CNAME www → cname.vercel-dns.com (both proxy OFF). 4) Add cliphy.app as custom domain in Vercel project settings. 5) Update env vars: extension .env.production VITE_API_URL, Vercel API_URL, mobile app config. 6) Update Stripe webhook + success/cancel URLs. 7) Update Supabase auth redirect URLs. 8) Update Sentry allowed origins. 9) Rebuild + deploy extension with new URL.

_Migrated from task-archive.md (CLIP-99, target —)._
