# Resume pointer

**State (2026-11-14):** All of creative coach build 1 is written and pushed to `main`: server (`/coach/*`, Inngest jobs, migrations `038`–`042`), phone screens (`apps/mobile/app/coach/`, `(tabs)/chat.tsx`), and the Mac helper (`apps/mac-helper`). 1399 unit tests pass and every package typechecks. **None of it has run for real**: no migration is applied, and nothing has touched a database, the Claude API, a phone or a Mac. Design: `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md`. Still pending from before: extension 1.2.0 zip not uploaded to the Chrome Web Store.

**Next:**

1. On a machine with env: apply `apps/server/supabase/migrations/038_…` to `042_…` in order with `psql "$DATABASE_URL" -f`, set `coach_enabled = true` on your account, then run `apps/server/scripts/coach-interpret-fixture.ts` and `coach-e2e.ts` (usage in each header). Expect `fixture ok` and `coach e2e ok`.
2. Rebuild the phone app (native: the share extension changed) and walk Chat → Setup: Allow reminders (the test must arrive), add a person with a phone number, turn on Capture.
3. On the Mac: follow `apps/mac-helper/README.md` (`login`, grant Full Disk Access, `check`, `install`), then text yourself from that person's thread and watch it arrive in Chat about 3 minutes later.

**Gotchas:** Expect first-run bugs in the phone screens and the helper; both were reviewed but never executed. Decide the reading model: `claude-opus-5-5` (current) or `claude-sonnet-5-5` at half the cost (`INTERPRET_MODEL`, `AGENT_MODEL`). `lore` is not installed on devbox2, so index rows for 2026-11-14 were added by hand: run `lore reindex` + `lore validate` for spec, plan, decision, devlog. The repo is public: fixtures and docs use the fictional "Maren" / "Alder House". Rulings and deferred minors per plan: `.superpowers/sdd/*.md` on devbox2 (git-ignored).
