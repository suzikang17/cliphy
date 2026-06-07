---
day: 62
date: 2026-04-18
phase:
mood: 😎 Smooth
hours:
tags: [infra]
published_to: []
public: false
title: "Day 62 — Move API to api.cliphy.app subdomain"
---

Migrated the API from cliphy.vercel.app / cliphy.app to the dedicated api.cliphy.app subdomain. Added the domain in Vercel, updated all env vars and hardcoded URL references across the codebase. One manual step remains: add the DNS A record in Cloudflare.

What got done

- Added api.cliphy.app domain to Vercel project (6b2f220)
- Updated VITE_API_URL and API_URL Vercel env vars to https://api.cliphy.app (prod)
- Updated apps/extension/.env and .env.production local files
- Updated all hardcoded fallbacks in App.tsx, middleware.ts, app.ts, smoke test scripts, package.json
- Bumped Vercel CLI v50 → v51.7.0 (via npm)

Issues

- Vercel CLI v50 bug: vercel env add VITE_API_URL preview always threw git_branch_required even when following the hint. Fixed by upgrading to v51.7.0.
- Preview VITE_API_URL: CLI v51 still requires a non-production branch. Not critical — web app uses relative paths. Set via Vercel dashboard if needed.

What to remember

- vercel env add <VAR> preview requires a non-production branch name — or use Vercel dashboard
- Use npm install -g vercel@latest not pnpm add -g (pnpm global bin dir not configured)
- PENDING: Add A record in Cloudflare: api → 76.76.21.21 (DNS only, no proxy) to activate api.cliphy.app

---

Commits

- 6b2f220 — move API to api.cliphy.app subdomain

── clip-105: Regenerate picks up current language ──

- Fixed: retry endpoint was reusing the original summary_language from when the video was first queued, ignoring any language change the user made since then.
- Fix: POST /:id/retry now fetches summary_language from user_settings and includes it in the pending reset update before firing the Inngest event. One-liner root cause once the data flow was traced.
- Commit: f279460 — regenerate button picks up current language preference
