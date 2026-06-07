---
date: 2026-02-16
title: "Switch from CRXJS to WXT"
category: Tech
revisit: false
---

# Switch from CRXJS to WXT

**Date:** 2026-02-16 · **Category:** Tech · **Revisit?** no

## Why this choice

Hit CORS bug on day 1 with CRXJS + Vite 5.4.12+. WXT is the industry standard (2025/2026), actively maintained, cross-browser, and doesn't have this issue. Switched early while everything was stubs — zero migration cost.

## Options considered

CRXJS (@crxjs/vite-plugin), vite-plugin-web-extension, WXT, Plasmo

## Tradeoffs

CRXJS: best HMR but semi-maintained, needed CORS workaround for Vite 5.4.12+. WXT: actively maintained, cross-browser, more features, but requires restructuring the extension. vite-plugin-web-extension: being deprecated in favor of WXT (same author). Plasmo: heavier, more opinionated than needed.
