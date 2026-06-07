---
date: 2026-02-21
title: "Tailwind CSS v4 for extension styling"
category: Tech
revisit: false
---

# Tailwind CSS v4 for extension styling

**Date:** 2026-02-21 · **Category:** Tech · **Revisit?** no

## Why this choice

v4 is current, simpler Vite setup (which WXT uses), no tailwind.config needed, all 3 extension surfaces share one CSS entry point, industry standard

## Options considered

Tailwind CSS v4 (Vite plugin, no config), Tailwind CSS v3 (PostCSS, requires config file), Plain CSS / CSS Modules (no deps but verbose)

## Tradeoffs

v4 is newer so some ecosystem tools may lag; adds ~14KB CSS to extension bundle (acceptable)
