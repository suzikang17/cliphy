---
date: 2026-02-21
title: "Per-run Allure reports via numbered subdirs on GitHub Pages"
category: Tech
revisit: false
---

# Per-run Allure reports via numbered subdirs on GitHub Pages

**Date:** 2026-02-21 · **Category:** Tech · **Revisit?** no

## Why this choice

Browsable without downloading. Auto-redirect to latest via index.html. Run number correlates with GHA UI. simple-elf/allure-report-action has native subfolder support.

## Options considered

1. Numbered subdirs on GitHub Pages (/ci/<run>/)
2. GHA artifacts (downloadable zip per run)
3. Both

## Tradeoffs

Old reports accumulate on gh-pages (keep_reports: 30 prunes from publish dir but keep_files: true preserves on branch). Acceptable for now.
