# Resume pointer — 2026-10-10

**State:** All work on main and deployed (server) / built (extension `apps/extension/.output/chrome-mv3`, reload unpacked in Dia/Chrome). Shipped since 10-09: Tabs view features (dupes, keywords, merge, reorder, shortcuts, rename/notes, times), ⌘⇧S quick-save, Trail (opt-in, migrations 033–034 applied), behaviour-based grouping with reasons (ADRs 0050–0051). Extension version still 1.1.0 in `wxt.config.ts`; Chrome Web Store upload not done.

**Next:**

1. Hands-on check in the browser: drag up/merge, rename/note, Trail capture, a Claude suggestion with a reason. Fix what the user reports.
2. Confirm the production Anthropic key has credits (local one is empty) — summaries + suggestions depend on it.
3. Bump extension version + upload to the Chrome Web Store when the user is happy.

**Gotchas:**

- Dia: unopened sidebar tabs are invisible to `tabs.query`; window focus requests are ignored (we move the tab instead).
- Never change layout inside `dragstart` — Chromium aborts the drag; defer a frame.
- `psql "$DATABASE_URL" -f` for migrations (remote has no CLI history); server dev reads repo-root `.env`.
- Full vitest runs sometimes get killed when chained with other commands (exit 144) — run them on their own.
