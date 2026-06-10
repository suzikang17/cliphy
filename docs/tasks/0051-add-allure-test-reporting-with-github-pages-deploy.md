---
title: "Add Allure test reporting with GitHub Pages deploy"
status: done
owner: none
type: infra
completed: 2026-02-21
---

# Add Allure test reporting with GitHub Pages deploy

Added allure-vitest reporter + allure-js-commons for labels. CI generates Allure HTML report, deploys to GitHub Pages. Excluded dist/ duplicates (89→47 tests). Product-oriented Allure labels: Queue, Summaries, Billing, Video Processing, End-to-End. parentSuite distinguishes Unit vs Smoke tests. Fixed suite hierarchy with nested describes, added categories config (Infrastructure/Product defects/Test defects), environmentInfo, layer + severity labels. Commits: ecdfd5c, 171a0b2, c955029, 6150c8b, ac150cb

_Migrated from task-archive.md (CLIP-51, target Day 6)._
