---
title: "lore v3 — providers doc type + slug strategy (design)"
date: 2026-06-09
---

# lore v3 — providers doc type + slug strategy (design)

**Date:** 2026-06-09
**Status:** Design — approved for spec review
**Builds on:** v2 (`~/dev/lore`, decisions + devlog doc types)

## Goal

Add **providers** as lore's third doc type — a per-record "reference" type — dogfooded against Cliphy's 7 real providers. The one new core capability is a **`slug` id strategy** (filename from the title; no number, no date). Roadmap is explicitly deferred (see below).

## Why providers fits, roadmap doesn't (decision)

- **Log types** (decisions, devlog): append-only, permanent, one-file-each + auto-index = lore's sweet spot.
- **Providers**: a small, stable, rich-record reference type (7 services, each with plan/cost/why/decision). Converts cleanly to per-record files; benefits from a generated index. Needs only a `slug` id strategy.
- **Roadmap — deferred.** Tasks are ephemeral, grouped-by-status, and churn constantly. Per-record (~39 micro-files) is the layout explicitly rejected at migration; "consolidated grouped-file" support is a different model worth its own design (and tasks may belong in GitHub issues, not lore). Not rushed into v3.

## New core capability: the `slug` id strategy

`id.strategy` gains a third mode: `slug`.

- **Filename:** `<slugify(title)>.md` — no numeric prefix, no date.
- **id:** unused (NaN), like `dated`.
- **Sort:** alphabetical by title (default), or by a configured field (`sortField`) — for providers, sort by `category` then title is nice-to-have; v3 sorts by title to keep it simple.
- **parseDoc** for `slug` strategy keeps the full basename (minus `.md`) as the slug (same as `dated` — no numeric-prefix parsing).
- **writeDoc** for `slug`: filename `<slugify(title)>.md`; collision (same slug exists) → error (don't silently overwrite).

This is a small, isolated addition to the v2-generalized core (`id.strategy` is already a discriminator in `parseDoc`/`readDocs`/`writeDoc`).

## The providers doc type

```yaml
name: provider
dir: providers
heading: Providers
id: { strategy: slug }
body: sections
sections: [Why, Cost notes]
frontmatter:
  - { name: title, type: string, required: true } # provider name, e.g. "Supabase"
  - { name: category, type: string } # Database | Hosting | AI | Payments | Jobs | Proxy
  - { name: status, type: string } # Active | Switched Away
  - { name: plan, type: string }
  - { name: monthly_cost, type: number } # $/mo (0 for free)
  - { name: date_evaluated, type: date }
index:
  - { header: Provider, source: title, link: true }
  - { header: Category, source: category }
  - { header: Status, source: status }
  - { header: Plan, source: plan }
  - { header: "$/mo", source: monthly_cost }
```

Each provider becomes `docs/providers/<slug>.md`, e.g. `docs/providers/supabase.md`, with frontmatter + a "Why" section (the rationale) and "Cost notes" (the cost detail). 7 files: anthropic-claude, supabase, vercel, inngest, stripe, decodo, webshare.

## Migrating the existing providers.md

Today's `docs/providers.md` is mixed. Split it:

1. **7 provider records** → `docs/providers/<slug>.md` (the new type). Source = the "Provider Tracker" table + per-provider detail already in providers.md.
2. **Budget table** → folded in: each provider's `monthly_cost` carries its cost; the few non-provider budget rows (domain, Chrome Web Store fee) → a short note appended to `docs/architecture.md` (or dropped — they're one-time fees already captured in decisions). Decide during plan; default: keep a tiny `## Costs` note in architecture.md.
3. **Services & env-var reference** (Core Services / Infra / Auth / Monitoring tables + env vars) → move verbatim into `docs/architecture.md` under a `## Services & environment` section (it's architecture/ops reference, not per-provider data).
4. Delete `docs/providers.md` once its content is relocated; update `docs/INDEX.md` to point at `providers/` and the architecture section.

## Backward compatibility

- `sequential` and `dated` strategies unchanged; `slug` is additive. Decisions + devlog unaffected (golden checks rerun).

## Dogfood

- Add `docs/.lore/types/provider.schema.yaml`.
- Create the 7 `docs/providers/<slug>.md` files (migration step, done by hand/script from providers.md content — verbatim).
- `lore validate provider` → `valid`.
- `lore reindex provider` → `docs/providers/INDEX.md` (Provider | Category | Status | Plan | $/mo).
- `lore reindex decision` + `lore reindex devlog` → unchanged (regression).

## Testing

- Unit: `slug` strategy — `writeDoc` filename `<slug>.md`, collision errors; `readDocs` sorts by title; `renderIndex` over slug-type docs (number column for $/mo).
- Golden: decisions + devlog INDEX unchanged.

## Out of scope (v3)

- Roadmap (deferred — own design).
- Consolidated/grouped single-file doc support.
- TUI polish (viewport scrolling, open-in-editor) — separate pass.
- The browser/multi-project layer.

## Decisions made (open to veto)

- v3 = providers only; roadmap deferred with rationale above.
- New `slug` id strategy (3rd mode).
- Providers become per-record files in `docs/providers/`; `providers.md` is split and removed.
- The env-var/services reference moves to `architecture.md` (it's ops reference, not provider records).
- Provider body uses `sections: [Why, Cost notes]` (cost/plan/category live in frontmatter + index).
