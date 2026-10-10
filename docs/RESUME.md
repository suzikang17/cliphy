# Resume pointer — 2026-10-09 (late)

**State:** Jev auto-tagging live (ADR 0048). iOS YouTube-share bug fixed (`a3738a1`). Tabs view (browsing-memory piece 1, ADR 0049) shipped server-side to prod (`d93a00c`, migration 031 applied); extension v1.1.0 committed (`0342995`, `0c116a1`) with store zip at `apps/extension/.output/extension-1.1.0-chrome.zip` — **not yet uploaded to the Chrome Web Store**.

**Next:**

1. Load unpacked `apps/extension/.output/chrome-mv3`, open ~15 tabs across two clients, add tags `client:x` + hints, toggle "Organize by page content", Cmd+Shift+K → screenshot. Fix anything found.
2. Upload the 1.1.0 zip to the Chrome Web Store; justify optional `scripting` + `<all_urls>` (Tabs view page-content toggle) in the privacy-practices tab.
3. Confirm re-summarize of clip `c75226d3…` (iOS long-press) and one fresh iOS YouTube share produced summaries + auto-tags.

**Gotchas:**

- Server dev reads repo-root `.env`; `apps/server/.env.local` has `DATABASE_URL`. Never `supabase db push` — `psql "$DATABASE_URL" -f`.
- Jev noul answers are phrasing-sensitive; probe variants live before trusting a threshold (see devlog).
- Extension version is hard-coded in `wxt.config.ts`; bump it for every store upload.
