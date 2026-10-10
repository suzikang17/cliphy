# Resume pointer

**State (2026-10-10):** Durable groups & pins shipped + deployed (main `c18c820` and later, API live on Vercel; migrations 030–036 applied). Pins (`p` / ⌘⇧P), close group ⇧C + Resume, group counts, Trail on by default with free-form retention, stale-tab stow ⇧W. Extension 1.2.0 zipped at `apps/extension/.output/extension-1.2.0-chrome.zip` — **not yet uploaded to the Chrome Web Store** (your action).

**Next:**

1. Load unpacked `apps/extension/.output/chrome-mv3` and drive the E2E: pin a tab → tile on new tab; ⇧C a tag group → reload browser → Resume reopens pages + that group's pins; stale marker on an old tab.
2. Upload the 1.2.0 zip to the Web Store (privacy text already updated live).
3. Deferred minors from the final review are listed in `docs/devlog/2026-10-10-durable-groups-and-pins.md` → pick the worth-it ones (resume error handling / "Opened 5 of 6", close-under-search, trim >100 pages).

**Gotchas:** Chrome allows 4 global commands — 3 used (⌘⇧K/S/P). Page identity = `normalizeUrl` (`@cliphy/shared`); trail rows hold raw URLs. Never `supabase db push` — `psql "$DATABASE_URL" -f` single files. TabsView keyboard handler must read everything via `latest.current` (deps `[helpOpen]`).
