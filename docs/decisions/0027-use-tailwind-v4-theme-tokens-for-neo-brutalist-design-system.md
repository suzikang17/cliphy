---
date: 2026-02-23
title: "Use Tailwind v4 @theme tokens for neo-brutalist design system"
category: Design
revisit: false
---

# Use Tailwind v4 @theme tokens for neo-brutalist design system

**Date:** 2026-02-23 · **Category:** Design · **Revisit?** no

## Why this choice

Tailwind v4 supports @theme natively — tokens become first-class utilities that compose with all variants. Zero config file needed, works with WXT's Vite setup. Component abstractions would over-engineer since most elements have enough variation per-use.

## Options considered

1. @theme + @utility in CSS (Tailwind v4 native)
2. tailwind.config.ts extend (v3 approach)
3. React component abstractions
4. Keep inline arbitrary values

## Tradeoffs

Locks to Tailwind v4+ (already committed). Only shadows were worth tokenizing — buttons, cards, status tags have too much variation to abstract.
