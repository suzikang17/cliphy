---
type: decision
title: "Website task runner: a poller on the devbox running Claude Code headless"
date: 2026-11-15
category: AI
revisit: true
---

## Why this choice

A client asks for a website change by text. The owner wants one tap in Chat to start it and a preview link, pictures and a pull request to come back. It has to cost nothing extra while it is only for her.

`apps/runner` is a small Node program on her devbox. It asks the API for queued runs, lets Claude Code make the change under her own Claude subscription, opens a draft pull request with `gh`, waits for Cloudflare's preview and reports back. The server knows nothing about the devbox: a runner is anything that speaks three calls (`POST /coach/runs/claim`, `/:id/checkin`, `/:id/finish`), so a hosted runner can replace it later without touching the phone or the task model.

How the client's text is kept in its box:

- A run exists only because the owner tapped. Starting one, and tapping any Chat button, is refused for API keys.
- Two users on the devbox. The runner's user holds the GitHub login and the Cliphy key and is the only one that runs `git` or `gh`. Claude Code and build commands run as a second user, in a copy of the code with no `.git`. The runner copies file contents back (no owners, no setuid bits, no devices) and commits with hooks off, so nothing the second user writes is run or read as configuration by the first. Neither user can read the other's folders. Before each run every process of the second user is stopped and its crontab, Claude settings and package-manager config are cleared.
- Claude Code is started with `--permission-mode dontAsk`, file tools limited to its own folder, a shell limited to the project's package manager, no web tools, and no settings files at all (`--setting-sources ""`), so neither a client repo nor an earlier run can bring its own permissions. The prompt goes in on standard input. Checked against the real CLI: `curl`, `git push` and reads or writes outside the folder are refused.
- The runner's API key has a scope (`api_keys.scope = 'runner'`): the three calls and the picture upload, nothing else.
- Only branches named `cliphy/…` are pushed.

## Options considered

- **GitHub Actions inside each client repo.** No devbox, but every client repo needs a workflow file and a Claude credential as a secret. Intrusive for repos made for clients, and uses Actions minutes.
- **A hosted agent in a cloud sandbox through the Claude API.** The eventual version for other users. Billed per token from the first task and the most to build.
- **Running tasks on the Mac.** The Mac is not always on and is where her own files are.

## Tradeoffs

- Works only while the devbox is up. The server says so in Chat when a run sits unclaimed for 30 minutes, and fails a run whose runner has been silent for 15.
- Shares her subscription's usage allowance with her interactive sessions. Acceptable for her own use only; other users need the hosted version.
- The second user is logged in to Claude with her subscription. A hostile build script could read that login, and it has the network. This is close to her building the repo by hand and is accepted for a single user.
- GitHub cannot limit a token to a branch pattern, so the "only `cliphy/…`" rule lives in the runner. Default branches of client repos should have branch protection.
- No turn cap: the installed CLI has no such flag. A 20-minute clock (`timeout`, run as the second user because the runner cannot signal another user's process) is the only limit.
- The shell allowlist (`pnpm`, `npm`, `node`, …) is not a wall: a package script can run any code as the second user. The separation of users is what holds; the tool list only keeps an honest Claude on the task.
- A final review found that the first version's copy-back kept setuid bits, which would have handed the second user the first user's identity. Fixed before any real run; see the devlog for 2026-11-16.
- Each repo needs one-time setup on the devbox ([`docs/runner-setup.md`](../runner-setup.md)).
- Where the preview address comes from (GitHub's deployments list) is unproven until the first real run.
