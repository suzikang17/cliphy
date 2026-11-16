# Cliphy runner

Makes website changes for the Cliphy coach. When the owner taps **Start on the
site** on the phone, a run is queued. This program claims it, lets Claude Code
make the change in a copy of the site's code, opens a draft pull request, waits
for the preview and sends back a summary, pictures and links to Chat.

It never pushes to a default branch, never merges and never deploys. Design:
[`docs/superpowers/specs/2026-11-14-website-task-runner-design.md`](../../docs/superpowers/specs/2026-11-14-website-task-runner-design.md).
Setting up a machine: [`docs/runner-setup.md`](../../docs/runner-setup.md).

## Commands

```sh
pnpm --filter cliphy-runner check   # is everything it needs in place?
pnpm --filter cliphy-runner once    # claim and do one run, then stop
pnpm --filter cliphy-runner start   # keep going
```

## Config

`~/.cliphy-runner/config.json`, readable only by the runner's user:

```json
{
  "apiUrl": "https://api.cliphy.app",
  "apiKey": "cliphy_sk_…",
  "workUser": "cliphy-work",
  "workRoot": "/srv/cliphy/work",
  "reposRoot": "/srv/cliphy/repos"
}
```

The key is a runner key, made on the phone (Setup → Runner key). It can claim a
run, check in, finish and upload a picture, and nothing else.

## Two users

The runner's own user holds the GitHub login and the Cliphy key, and is the
only one that runs `git` or `gh`. Claude Code and every install or build
command run as `workUser`, in a copy of the code that has no `.git`. The
runner copies file contents back into its own clone (no owners, no special
permission bits, no devices) and commits with hooks off. Neither user can read
the other's folders. So a client's text, a tricked Claude or a hostile build
script cannot reach either credential, and nothing they write is run by the
runner's user.

Claude Code is started with file tools limited to its own folder, no web
tools, no settings files, and a shell limited to the project's package manager
and `node`. That last part is not a wall: a package script or `node` can run
any code as the work user, with the network. What holds is the separation of
users, not the tool list. The prompt goes in on standard input, not on the
command line. See `claudeArgs` in `src/machine.ts`.

Between runs the runner stops every process of the work user and clears its
crontab, Claude settings and package-manager config, so one client's run
leaves nothing for the next. Claude runs under `timeout`, as the work user,
because the runner cannot signal another user's process itself.

## Layout

- `src/run.ts` — one run, start to finish. Everything outside is passed in.
- `src/prompt.ts` — what Claude is asked, and reading its answer.
- `src/machine.ts` — git, GitHub and Claude Code on this machine.
- `src/preview.ts` — finding the preview address Cloudflare reported to GitHub.
- `src/api.ts` — the three calls: claim, check in, finish.
- `src/contract.ts` — the shapes those calls carry.

Tests: `pnpm exec vitest run apps/runner`.
