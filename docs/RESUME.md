# Resume pointer

**State (2026-11-14):** Creative coach build 1 is designed (`docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md`) and plan 1 of 6, the server core, is built and pushed (main `3a68e94`): `/coach/*` routes, migration `038_coach_core.sql`, Inngest bundle jobs. 597 unit tests pass. **Nothing has run against a database or the model**: migration 038 is unapplied and Task 9's end-to-end run is still owed. Still pending from before: extension 1.2.0 zip not uploaded to the Chrome Web Store.

**Next:**

1. On a machine with env: `psql "$DATABASE_URL" -f apps/server/supabase/migrations/038_coach_core.sql`, set `coach_enabled = true` on your account, then run `apps/server/scripts/coach-interpret-fixture.ts` and `coach-e2e.ts` (usage in each file's header). Expect `fixture ok` and `coach e2e ok`.
2. Decide the interpretation model: `claude-opus-5-5` (current) or `claude-sonnet-5-5` at half the cost (`INTERPRET_MODEL` in `services/coach/interpret.ts`).
3. Write plan 2 (reminders and push) from the spec; the plan table is at the top of `docs/superpowers/plans/2026-11-14-creative-coach-1a-server-core.md`.

**Gotchas:** Current Claude models reject forced `tool_choice`; the installed SDK is 0.39 (no strict tools). `lore` is not installed on devbox2, so index rows for 2026-11-14 were added by hand: run `lore reindex` + `lore validate` for spec, plan, decision, devlog. The repo is public: fixtures and docs use the fictional "Maren" / "Alder House". Ledger with every ruling and deferred minor: `.superpowers/sdd/2026-11-14-creative-coach-1a-server-core/progress.md` (git-ignored, on devbox2 only).
