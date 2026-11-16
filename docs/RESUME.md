# Resume pointer

**State (2026-11-16):** The website task runner is built through task 9 of 10 (`docs/superpowers/plans/2026-11-15-website-task-runner.md`) and pushed to `main`; server and phone parts are deployed. **Nothing has run for real:** migration `045_coach_runs.sql` is not applied, the devbox is not set up, no run has been made, and the new phone screens have not been seen on a device. The Mac app runs from source and the history piece ("Still needs doing") is live but not yet tried by the owner. Still open: the phone redesign ("AI concierge", luxury feel) is waiting on the owner's reference products; extension 1.2.0 zip not uploaded to the Chrome Web Store.

**Next (task 10, each step needs the owner's say-so):**

1. Ask, then apply `apps/server/supabase/migrations/045_coach_runs.sql`. Confirm `coach_runs` exists and every existing `api_keys.scope` is null.
2. Set up the devbox by following `docs/runner-setup.md` literally, fixing the page where it is wrong. `pnpm --filter cliphy-runner check` must pass every line.
3. Make a scratch "Alder House" site repo on Cloudflare, then three real runs: one that works, one that cannot, one stopped while working.

**Gotchas:** Unproven until the devbox: that `timeout`/`pkill` really stop the work user's Claude, and that Cloudflare's preview shows up in `gh api repos/<repo>/deployments` (`apps/runner/src/preview.ts` is the one place to change). `ANTHROPIC_API_KEY` in the work user's environment breaks the Claude login. Rulings and deferred minors are in `.superpowers/sdd/2026-11-15-website-task-runner/progress.md` on this Mac (git-ignored; delete it when task 10 is done). The devlog for 2026-11-16 has the review findings. The repo is public: fixtures use only "Maren" / "Alder House". The Mac app in /Applications still has the quit bug until a new disk image is installed.
