---
title: "Move API to api.cliphy.app subdomain"
status: done
owner: none
type: infra
completed: 2026-04-18
---

# Move API to api.cliphy.app subdomain

Added api.cliphy.app domain in Vercel. Updated VITE_API_URL + API_URL env vars on Vercel (prod). Updated all hardcoded API URL references across extension, server, web, scripts. Commit: 6b2f220. Cloudflare DNS: add A record api → 76.76.21.21.

_Migrated from task-archive.md (CLIP-106, target —)._
