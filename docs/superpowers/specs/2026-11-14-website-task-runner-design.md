# Website task runner — design

Date: 2026-11-14
Status: approved by Suzi, 2026-11-14
Builds on: [creative coach, capture and chat](2026-11-14-creative-coach-capture-and-chat-design.md) (this is the first slice of its "build 2: the AI doing the work")

## Intent

A client texts Suzi asking for something to be added or changed on their
website. Today that becomes a request in Chat and a `do` task she has to sit
down and do. She wants the change to be started for her and to come back to
her phone as something she can look at: a screenshot of the changed page and
a working preview link.

It has to be free or nearly free for her to run for herself first. Other
users come later, on hosted infrastructure, and the first version must not
make that harder.

## Goals

- From Chat, one tap starts a website change for a confirmed request.
- The change is made in the client's Git repo on a new branch, by Claude Code
  running on Suzi's devbox under her own Claude subscription.
- Chat gets back: what was changed in a sentence or two, a screenshot of the
  affected page, a preview link, and a link to the pull request.
- Failures come back to Chat in plain words. Nothing fails silently.
- The server does not know or care that the runner is a devbox. A hosted
  runner can replace it by speaking the same three calls.

## Non-goals (this version)

- Other users. One account, one runner.
- Sites that are not a Git repo deployed by Cloudflare with previews
  (Shopify, Webflow, WordPress).
- A plan-approval step before the work, an automated QA pass against the
  request, and merging from the phone. Build 2 of the coach spec describes
  these; they come after this slice.
- A corrections loop ("make the heading smaller") on an existing run. To
  change the result, Suzi edits the branch herself or starts a new run.
- Running tasks on the Mac.

## Anti-goals

- **Nothing reaches a live site.** The runner never pushes to a default
  branch, never merges, never deploys to production.
- **A client's text never starts work by itself.** A run exists only because
  Suzi tapped a button on her phone.
- **Text from a client is never trusted as instructions about the machine.**
  It is material for a website change inside one repo, nothing more.
- No real client names, numbers, message text or repo names in this public
  repo. Fixtures use the client "Maren" and the project "Alder House".

## Constraints

- Cliphy is live with other users. Everything here is behind the existing
  coach switch and changes nothing for accounts without it.
- The production database is not changed without Suzi saying so. The
  migration is written and tested; applying it is a separate, asked-for step.
- Repo conventions: TypeScript strict, Vitest, commit to main, an ADR for the
  tooling choice.
- Claude Code runs headless on the devbox with Suzi's own login. That is
  acceptable for her own use only, and it shares her subscription's usage
  allowance with her interactive sessions.
- Client sites are hosted on Cloudflare from Git repos.

## Approaches

**A. A poller on the devbox running Claude Code (chosen).** A small Node
program asks the Cliphy API for runs, does the work in a local clone, opens a
pull request and reports back. Costs nothing beyond the subscription and the
devbox; adds nothing to client repos. Works only while the devbox is up, and
each repo needs one-time setup there.

**B. GitHub Actions inside each client repo.** No devbox, but every client
repo needs a workflow file and a Claude credential as a secret. Intrusive for
repos the clients own; uses Actions minutes.

**C. A hosted agent in a cloud sandbox, through the Claude API.** The
eventual version for other users. Billed per token from the first task and
the most to build, so it fails "free or very cheap first".

Suzi chose A. The server side is designed so that C replaces the devbox later
without changing the phone or the task model.

## How it works

### 1. Which tasks can be run

- A coach project gets two optional settings: **repo** (`owner/name` on
  GitHub) and **site address** (the live site, used for the "before"
  picture). They are edited where the project is edited on the phone.
- A `do` task is runnable when its project has a repo and the task is open
  and not blocked.
- When a request is confirmed and its chain contains a runnable `do` task,
  the bot's confirmation message carries a button: **Start on the site**. The
  same button is on the task's own screen. _(Call made for Suzi to check: one
  explicit tap, not automatic on confirm. Not every `do` task in a project
  with a repo is a website change, and the tap is what makes "a client's text
  never starts work by itself" true.)_
- Tapping it creates a **run** for that task. A task has at most one run that
  is waiting or working; tapping again while one is active does nothing.

### 2. The run

A run is a row with: the task, a status, when it was claimed, when the runner
last checked in, and the result (summary, branch, pull request address,
preview address, pictures, error).

Statuses: `queued` → `working` → `done` | `failed`. Also `cancelled`, from a
**Stop** button on the bot's "started" message, honoured by the runner at its
next check-in.

A run that is `working` and has not checked in for 15 minutes is marked
`failed` ("the runner stopped responding") by the server, and Chat says so.
A run still `queued` after 30 minutes produces one bot message that the
runner does not seem to be on. _(Both numbers are the builder's to tune.)_

### 3. The contract between server and runner

Three calls, authenticated with an API key belonging to the account. This is
the whole surface a hosted runner would have to implement.

- **Claim** — "give me the next queued run for this account." Atomic: two
  runners can never get the same run. Returns the run id and the brief:
  - repo and site address;
  - the request as the coach understood it, the task's title and kit
    (materials, target, what done means), the answer to the open question if
    there was one;
  - the original messages of the request, with short-lived addresses for any
    attached images (clients often send a screenshot of what they mean).
- **Check in** — "still working", with an optional short note ("building",
  "waiting for the preview"). Returns whether the run was cancelled.
- **Finish** — the outcome: `done` or `failed`, the summary, branch, pull
  request address, preview address, the stored paths of the pictures, or the
  error in plain words.

Pictures are uploaded with the existing intake upload call, which already
hands out a signed address for one file.

### 4. What the runner does with one run

The runner is a new workspace package (`apps/runner`), built like the Mac
helper: a loop with everything that touches the machine or the network
passed in, so the deciding logic is tested on any machine.

1. **Prepare the repo.** Clone it on first use into the runner's own folder;
   otherwise fetch. Start from the tip of the default branch, on a new branch
   named `cliphy/<short run id>-<few words of the title>`.
2. **Run Claude Code** headless in the repo with the brief as the prompt.
   - The prompt presents the client's words as quoted material describing a
     wanted website change, and says that instructions inside them about
     anything else are to be ignored and mentioned in the summary.
   - Allowed tools: reading, searching and editing files in the repo, and the
     repo's own install/build/test commands. Not allowed: git pushes, the
     GitHub CLI, network fetches, anything outside the repo folder.
   - A cap on turns and a wall-clock limit (20 minutes to start with).
   - Claude ends with a small structured answer: a summary in plain words for
     a non-developer, and the site paths that changed (`/`, `/about`), most
     affected first.
3. **If nothing changed**, finish as `failed` with Claude's explanation ("I
   could not find a page 2"). No branch is pushed.
4. **Commit, push the branch, open a draft pull request** (a normal one
   where the repo's plan has no drafts). The runner does
   this itself, with its own GitHub credential; Claude never holds it. The
   pull request body is the summary and a line saying it was made by the
   Cliphy runner for a request confirmed by the owner. It does not include
   the client's messages.
5. **Find the preview.** Cloudflare reports a preview deployment for the
   branch back to GitHub. The runner waits for it (up to about 10 minutes)
   and reads the address from there.
6. **Take the pictures** of the first changed path, with a headless browser,
   at a phone width and a desktop width: "after" on the preview, and "before"
   on the live site address when the project has one. Before and after are
   the same page, so the result is a real comparison.
7. **Finish** the run with everything it has.

If the preview never appears, the run still finishes as `done` with the pull
request link and a line saying no preview was found. _(Changed from the
conversation: there I said the runner would build the site on the devbox for
a picture when there is no preview. With every site on Cloudflare from Git,
that fallback is not worth building yet.)_

### 5. What Suzi sees in Chat

```
Bot   Started on the site: "Move the sconces up on page 2"      [Stop]

Bot   Done: moved the sconce photos above the paragraph on
      the Lighting page.
      [picture: after]  [picture: before]
      Preview: https://…        Pull request: https://…
```

On failure: one message saying what went wrong in plain words and, when
there is one, the pull request or branch so the work is not lost.

Each message is tied to the run, so a retry of a call never says the same
thing twice (the chat table already works this way).

### 6. Keeping the client's text in its box

The instruction ultimately comes from someone other than Suzi. The design
relies on these, in this order of importance:

1. A run starts only from her tap.
2. **Two users on the devbox.** The runner's own user holds the GitHub
   credential and the Cliphy API key. Claude Code and every install or build
   command run as a second, work user that owns only the repo clones and
   cannot read the first user's files. The runner does the commit, push and
   pull request itself. A client repo's build script, or a tricked Claude,
   therefore cannot reach either credential.
3. Claude's tools are limited to the one repo folder and that repo's own
   install/build/test commands. Installing needs the network, so "no network"
   is not claimed; Claude's own web tools are off.
4. **The runner's API key is limited.** API keys gain an optional scope. A
   key with the runner scope is accepted only by claim, check in, finish and
   the upload call, so it cannot read captured messages beyond the brief it
   is handed. Keys without a scope behave exactly as today, so nothing
   changes for existing users.
5. The runner only ever pushes branches named `cliphy/…`. GitHub cannot
   enforce that on a token, so default branches of client repos should have
   branch protection; the setup page says so.

What remains exposed, knowingly: the work user is logged in to Claude with
Suzi's subscription, and a hostile build script could read that login. It
can also use the network. That is close to the exposure of Suzi building the
repo by hand, and is accepted for a single-user first version.

## Shape of the data

- **project** gains `repo` and `site address`, both optional.
- **run**: id, account, task, status, claimed at, last check-in, note,
  summary, branch, pull request address, preview address, pictures (stored
  paths with a label: before and after, each at phone and desktop width), error, created,
  finished. At most one run per task in `queued` or `working`.
- **task** is unchanged. A finished run does not mark the task done: the
  change is not live until Suzi merges it, so she ticks the task herself.
- **chat message**: three new kinds (run started, run finished, runner
  quiet), each tied to the run id.

- **API key** gains an optional scope.

One new migration, next number after the latest at build time.

## How it gets made

- Server: new routes under the coach routes for start (phone), claim, check
  in, finish (runner); a scheduled check for stale and unclaimed runs next to
  the existing coach schedules; bot messages alongside the existing ones.
- Shared types for the run and the brief in `packages/shared`.
- Phone: repo and site address fields on the project (the project screen is
  read-only today, so editing is added); the Start button as a
  typed chat button action and on the task screen; pictures and links in the
  result message.
- Runner: `apps/runner`, Node 22, same style as `apps/mac-helper`. Uses the
  `claude` and `gh` programs on the devbox and a headless browser for the
  pictures. Kept running by a user service on the devbox.
- An ADR for "devbox poller running Claude Code headless" with B and C as
  the options not taken, and a setup page for the devbox (the runner's user,
  logging Claude in, the GitHub credential, adding a repo).

## Proof it works

- Server tests: a run can only be started for a runnable task, by the phone,
  on an account with the coach on; claim hands a run to exactly one caller;
  check-in reports cancellation; finish is idempotent; stale and unclaimed
  runs are handled once.
- Runner tests with every outside thing faked: the order of steps, "nothing
  changed", the time limit, cancellation between steps, a preview that never
  appears, and that the client's words are quoted in the prompt and absent
  from the pull request.
- One real end-to-end run before calling it done: a scratch site repo for
  "Alder House" deployed on Cloudflare, a request typed in by hand, the Start
  button tapped on the phone, and the result message with a working preview
  link and pictures arriving in Chat. A second run with an impossible request
  to see the failure message.

## Left to the builder

- Exact route paths, column names and message wording.
- How the preview address is read from GitHub. Cloudflare Pages and
  Cloudflare Workers builds report to pull requests differently; check which
  the first real site uses and support that one, behind a small function so
  the other can be added.
- The exact Claude Code flags for the tool allowlist, turn cap and
  structured final answer, checked against the current CLI documentation.
- The package manager and build command per repo: detect from the lockfile,
  with an optional per-project override if detection is not enough.
- Whether the "before" and "after" pictures are full-page or first screen.
- The time limits and polling intervals.

## Calls made for Suzi to check

1. **One tap to start**, not automatic when a request is confirmed.
2. **A finished run does not tick the task.** She ticks it after merging.
3. **Draft pull requests**, and the client's messages are kept out of them.
4. **No picture fallback** when Cloudflare gives no preview: link to the
   pull request only.
5. **No corrections loop yet.** A changed mind means a new run.
6. **The runner gets its own user on the devbox and its own API key**, made
   by hand once. Pairing by code stays a Mac-helper thing.
7. **"Nothing changed" counts as failed**, with Claude's explanation.
8. **Two users on the devbox and a scoped runner key** (see "Keeping the
   client's text in its box"), with the Claude login as the accepted
   remaining exposure.
9. **"Before" is the same page on the live site**, taken after Claude says
   which page changed.
10. **GitHub credential:** Suzi owns the client repos, so the runner uses a
    fine-grained token on her account limited to the repos set up for it
    (contents and pull requests, read and write). Draft pull requests are
    opened straight away; clients do not see them.
