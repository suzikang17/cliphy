# Resume pointer

**State (2026-11-17):** Captured texts now reach Chat in production (Inngest jobs are re-registered after every deploy). Batches (pick finished work, check each item, model-written summary for the client), hand-added tasks, texts pulled into a task, and a Projects tab are deployed; migration `046_coach_batches.sql` is applied. The Mac window now shows the full app (Chat, Projects, Up next) beside the helper's setup screen (ADR 0064). **Not yet tried by the owner:** any of the new phone screens on a device, a summary from the real model, sent-detection from the Mac, and the Mac window on her Mac (CI runs it on a Mac and takes pictures; see the "Mac app" workflow's `screens` artifact). The website task runner is still at task 9 of 10 and `045_coach_runs.sql` is still not applied.

**Next:**

1. Owner tries it: phone (Projects tab → project → New batch → check → Write summary → Send) and Mac (`git pull`, `pnpm install`, `pnpm --filter cliphy-helper-app start`). Fix what she finds.
2. MCP server for the coach so Claude Code / Claude / ChatGPT can read and add work (BACKLOG; she asked, nothing is built). Auth with the existing `cliphy_sk_` keys.
3. Open bug: a tapped Chat answer saved the request and tasks but stored no "Saved. N tasks added." message. Needs the Vercel log (`npx vercel login` on the devbox first).

**Gotchas:** The web build of `apps/mobile` means "the Mac window" (`lib/desktop.ts`): no sign-in, the Mac app answers `/api/` with its own key. Check `npx @expo/fingerprint fingerprint:generate` before and after touching `apps/mobile/package.json`, or phone updates stop reaching the installed build. On the devbox: no gstack `/browse`, no system fonts, `hermesc` cannot run (use `expo export --no-bytecode`), Vercel CLI is logged out; `pnpm --filter cliphy-helper-app preview` shows the Mac window's app in a browser on made-up data. Production database changes need the owner's go-ahead each time; single files only, never `db push`. The repo is public: fixtures use only "Maren" / "Alder House". Runner notes from 2026-11-16 are in that day's devlog and `docs/runner-setup.md`.
