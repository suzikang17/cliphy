---
date: 2026-02-14
title: "Single repo with folders (not monorepo)"
category: Tech
revisit: false
---

# Single repo with folders (not monorepo)

**Date:** 2026-02-14 · **Category:** Tech · **Revisit?** no

## Why this choice

Simplest approach for solo dev. Co-located code with shared types via relative imports. One package.json, no workspace config. Monorepo tooling (pnpm workspaces, Turborepo) adds complexity with no benefit at this scale.

## Options considered

Monorepo (pnpm workspaces), single repo with folders, two separate repos, Turborepo, Nx

## Tradeoffs

If the project grows to multiple teams or published packages, may need to upgrade to workspaces later. For now, simplicity wins.
