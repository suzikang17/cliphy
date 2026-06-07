---
date: 2026-02-19
title: "esbuild bundling + Build Output API v3 for Vercel deployment"
category: Tech
revisit: false
---

# esbuild bundling + Build Output API v3 for Vercel deployment

**Date:** 2026-02-19 · **Category:** Tech · **Revisit?** no

## Why this choice

pnpm strict module isolation prevents root-level api/index.ts from resolving deps in apps/server/node_modules. esbuild bundles everything into a single CJS file, eliminating all resolution issues. Build Output API v3 gives full control over runtime config (.vc-config.json). getRequestListener from @hono/node-server converts Hono's Web API handler to the (req, res) callback format that Vercel Node.js runtime requires.

## Options considered

Vercel serverless functions (api/ dir), Build Output API v3 with esbuild, Vercel Edge Functions, Docker/container deployment

## Tradeoffs

esbuild bundling adds a build step but eliminates pnpm hoisting hacks (--shamefully-hoist). Build Output API is more manual than Vercel's auto-detection but gives precise control. Using @hono/node-server's getRequestListener instead of hono/vercel's handle() is less "official" but actually works. CJS format required for Node.js runtime compatibility.
