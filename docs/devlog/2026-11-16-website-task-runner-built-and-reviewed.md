---
lore_type: devlog
created: 2026-11-16
title: "Day 71 — Website task runner: built, reviewed, not yet run for real"
date: 2026-11-16
day: 71
phase: Growth
---

**Built the website task runner (tasks 1–9 of its plan): one tap in Chat queues a run, a runner on the devbox makes the change with Claude Code and reports back with a pull request, preview and pictures. The server and phone parts are deployed. Nothing has run on the devbox yet, the migration is not applied, and no real run has been made.**

## What got done

- **Server.** Migration `045_coach_runs.sql` (written, not applied). API keys can carry a `runner` scope that allows four calls only. Run routes: start, stop and read for the phone; claim, check in and finish for the runner. Chat says when a run starts, finishes or stops, each once per run. A sweep fails a run whose runner has been silent for 15 minutes and says once when a run sits unclaimed for 30.
- **Runner (`apps/runner`).** The order of steps and every way of failing are in `run.ts`, tested with everything faked. `machine.ts` does git, GitHub and Claude Code; `preview.ts` reads the preview address from GitHub's deployments; `main.ts` has `run`, `once` and `check`.
- **Phone.** Website repo and live site fields on the project, "Start on the site" and a status line on the task's page, tappable links and pictures in Chat, a "Runner key" row in Setup.
- **Docs.** ADR 0062, `docs/runner-setup.md`, a paragraph in `architecture.md`.

Checked:

- 591 tests across the touched areas pass; typechecks and lint are clean.
- The runner's exact Claude Code flags were tried with the real CLI in a scratch folder. It edited the file and gave a structured answer. It was refused `curl`, `git push`, `cat`, and reading or writing outside its folder.
- Live API after deploy: the Mac helper's existing key still gets 200; starting a run with a key gets 403; claim answers `{ run: null }`; tapping a Chat button with a key gets 403.

Not checked: anything on the devbox, a run end to end, the phone screens on a device, where Cloudflare puts the preview address, and whether `timeout` and `pkill` really stop another user's Claude.

## Decisions

- **Claude never works in a folder with git history.** The runner keeps its own clone, hands the work user a copy without `.git`, and copies file contents back before committing with hooks off.
- **The runner keeps its own copy of the contract types** (`contract.ts`) so it depends on nothing but the three calls.
- **Links are written into the message text** and the phone makes them tappable, so the chat table did not change.
- **All Chat button taps are refused for API keys**, not only the one that starts a run.
- **The shell allowlist is not treated as a wall.** A package script can run any code as the work user. The separation of users is what holds.

## Issues

- **The final review found a critical hole.** The copy-back used `rsync -a`, which keeps setuid bits. A hostile build script could have left a setuid copy of a shell in a folder the runner owns and then run it as the runner, reading the GitHub token. Fixed: `-rlt --executability --chmod=ug-s,o-w`, the runner's clones closed (`700`), the copy out done through a `tar` pipe, and every process of the work user killed before its files are read.
- Also from the review, all fixed test-first:
  - an API key could tap a Chat button and so start a run;
  - the runner cannot signal another user's `sudo` child, so a time limit or Stop would not have killed Claude; it now runs under `setsid --wait timeout`, and Stop uses the work user's own `pkill`;
  - a single failed check-in threw away a finished run;
  - a run could end without Chat being told;
  - Claude was given web addresses for the client's pictures but has no web tools; they are now fetched into its folder as files.
- **Deploy before migration.** The auth middleware first named the new `scope` column in its select. On a database without that column every existing key would have been refused, including the Mac helper's. It now selects `*` and writes `scope` only when asked.

## What to remember

- `ANTHROPIC_API_KEY` in the environment overrides the Claude subscription login. The symptom is "Credit balance is too low". The work user must not have it set.
- Claude Code's tool-list flags are variadic and would swallow a prompt given as the last argument. The prompt goes in on standard input.
- A bare `Read`, `Edit` or `Write` allow rule lets Claude read or write anywhere the user can. `Read(./**)` and friends keep it to the folder it was started in.
- `--setting-sources ""` works and loads no settings files at all.
- The installed CLI (2.1.325) has no `--max-turns`.
- Platform lessons are in the dev wiki, `concepts/claude-code-headless.md` ("Letting it change a repo you do not trust").
- The deferred minor findings are in the plan's ledger, `.superpowers/sdd/2026-11-15-website-task-runner/progress.md`. That folder is git-ignored and is deleted when task 10 is done, so they are also in the session's final message.
- Next: task 10. Ask before applying migration 045, set up the devbox from `docs/runner-setup.md`, make a scratch "Alder House" site on Cloudflare, then three real runs.

---

## Commits

- `ce0601e` add plan for the website task runner
- `fef7e92` add runs table, project repo fields and run types
- `f0d2d46` let an API key be limited to the runner's calls
- `2f943fa` add run routes: start, cancel, claim, check in, finish
- `99eb90d` say in Chat when a run starts, finishes or stops
- `5991083` fail runs whose runner went quiet and say when none is on
- `8f84890` add the runner's deciding logic
- `78c4ca9` run Claude Code, git and the pull request from the runner
- `d97d1f4` start a run and see its result from the phone
- `f07d64d` document the runner: decision and devbox setup
- `745f037` close the holes the runner's review found
