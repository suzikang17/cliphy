# Resume pointer — 2026-10-09

**State:** Jev (TypeSafe AI) auto-tagging is live in prod (`8a0afaf`, `5ba2c88`, `132e37f`). Every new video summary runs an `auto-tag` Inngest step: existing tags auto-apply, Claude `topics` that match nothing land in `clips.suggested_tags` → accept/dismiss chips in extension, web, mobile. Migration 030 applied; `TYPESAFE_API_KEY` set locally + Vercel prod/preview. Devlog: `docs/devlog/2026-10-09-jev-auto-tagging.md`, ADR 0048.

**Next:**

1. Confirm the prod Anthropic key has credits (local one is empty), then summarize a real video in prod and check `tags`/`suggested_tags` on the row.
2. Eyeball the suggestion chips + TAG_LIMIT upgrade prompt in each client (none were browser/simulator-tested).
3. Pick from BACKLOG: route `enrich` through the tagger, backfill old clips, tune thresholds.

**Gotchas:**

- Server dev reads the repo-root `.env`; `apps/server/.env.local` has `DATABASE_URL`. Never `supabase db push` (remote has no migration history) — `psql "$DATABASE_URL" -f <file>`.
- YouTube summarize always refetches the transcript via the Decodo proxy (407 locally right now) — drive later steps directly to test (see devlog).
- Vercel runtime must be `nodejs22.x` in `scripts/build-vercel.sh`; 20.x deploys fail at the deploy step even though the build passes.
