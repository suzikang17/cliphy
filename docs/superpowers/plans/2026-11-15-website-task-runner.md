# Website Task Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap in Chat starts a website change for a confirmed request; Claude Code makes it on the devbox in a new branch, and Chat gets back a summary, before/after pictures, a preview link and a pull request link.

**Architecture:** The server gains a `coach_runs` table and six routes: start, cancel and read for the phone; claim, check in and finish for the runner. A new package `apps/runner` polls claim, runs Claude Code as a second devbox user in a copy of the repo that has no `.git`, then commits, pushes and opens the pull request itself from its own clone. The server never learns that the runner is a devbox.

**Tech Stack:** Hono + Supabase + Inngest (server), Vitest, Node 22 + tsx (runner), `claude` and `gh` programs, Playwright Chromium for pictures, Expo (phone).

**Spec:** `docs/superpowers/specs/2026-11-14-website-task-runner-design.md`

## Global Constraints

- The repo is public. No real client names, numbers, message text or repo names anywhere. Fixtures use the client "Maren" and the project "Alder House"; the fixture repo is `example/alder-house`.
- **Do not apply the migration to production and do not run Supabase migrations.** Task 1 writes it; applying it is Task 10, after Suzi says so.
- Everything is behind the existing coach switch (`requireCoach`). Accounts without it, and API keys without a scope, behave exactly as today.
- Nothing reaches a live site: the runner pushes only branches named `cliphy/…`, never merges, never deploys.
- A run exists only because of a tap on the phone (JWT). An API key can never start one.
- The client's words go into the Claude prompt as quoted material and never into the pull request, the commit message or the branch name beyond the task title's words.
- Tests first for every task. Commands: `pnpm exec vitest run <paths>`, then `pnpm --filter <package> typecheck`, then `pnpm lint`.
- Commit to main, imperative mood, ending `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. `git pull --rebase --autostash` before every push. Stage named paths only, never a whole app folder.
- Every new test file starts its `beforeEach` with `layer("unit"); epic("Coach"); feature("Runner");` from `allure-js-commons`, like its neighbours.
- Four server test files fail on this Mac before any change (image library, embeddings, admin). They are not this plan's to fix.

## Review Focus

1. **A hostile repo plants something in `.git`** (a hook, `core.fsmonitor`) hoping the runner's user runs it at commit time. Expected: impossible, because Claude's copy has no `.git` and the runner commits from its own clone with hooks off. Pinned in Task 7.
2. **Finish arrives after Stop, or twice.** Expected: one result message, status stays `cancelled` if it was cancelled, no error to the runner. Pinned in Task 3.
3. **Two claims at once.** Expected: one caller gets the run, the other gets "nothing queued". Pinned in Task 3.
4. **Claude changes files but its final answer is not valid JSON, or it times out with changes made.** Expected: the run fails in plain words and no branch is pushed. Pinned in Task 6.
5. **A runner-scoped key calls any other route** (people, chat, intake messages). Expected: 403. Pinned in Task 2.

---

### Task 1: Migration and shared types

**Files:**

- Create: `apps/server/supabase/migrations/045_coach_runs.sql`
- Modify: `packages/shared/src/coach.ts`, `apps/server/src/lib/coachMappers.ts` (`toProject`)
- Test: `packages/shared/src/__tests__/coachRuns.test.ts`, `apps/server/src/routes/coach/__tests__/projects.test.ts`

**Interfaces:**

- Produces (all exported from `@cliphy/shared`):
  ```ts
  export type RunStatus = "queued" | "working" | "done" | "failed" | "cancelled";
  export interface RunPicture {
    label: "before" | "after";
    width: "phone" | "desktop";
    storagePath: string;
    url?: string;
  }
  export interface CoachRun {
    id: string;
    taskId: string;
    status: RunStatus;
    note: string | null;
    summary: string | null;
    branch: string | null;
    prUrl: string | null;
    previewUrl: string | null;
    pictures: RunPicture[];
    error: string | null;
    createdAt: string;
    claimedAt: string | null;
    finishedAt: string | null;
  }
  export interface RunBrief {
    runId: string;
    repo: string;
    siteUrl: string | null;
    understood: string;
    answer: string | null;
    task: { title: string; kit: TaskKit };
    messages: { direction: Direction; text: string; sentAt: string; imageUrls: string[] }[];
  }
  export interface RunOutcome {
    status: "done" | "failed";
    summary?: string;
    branch?: string;
    prUrl?: string;
    previewUrl?: string;
    pictures?: Omit<RunPicture, "url">[];
    error?: string;
  }
  export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  export function isRunnable(
    task: Pick<CoachTask, "kind" | "state" | "blocked">,
    project: Pick<Project, "repo"> | null,
  ): boolean;
  ```
- `Project` gains `repo: string | null; siteUrl: string | null`.
- `ChatAction` gains `{ type: "start_run"; taskId: string }` and `{ type: "stop_run"; runId: string }`.
- `ChatKind` gains `"run_started" | "run_finished" | "runner_quiet"`.

- [ ] **Step 1: Write the failing tests.** In `coachRuns.test.ts`: `isRunnable` is true only for kind `do`, state `open`, `blocked: false`, project with a repo; false for each of: kind `tell`, state `done`, blocked, project null, repo null. `REPO_PATTERN` accepts `example/alder-house`, rejects `alder-house`, `https://github.com/example/alder-house`, `a/b/c`, `a/b;rm -rf`. In `projects.test.ts`: a project row with `repo: "example/alder-house", site_url: "https://alderhouse.example"` comes back from `GET /api/coach/projects` with `repo` and `siteUrl`; a row without them gives `null` for both.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/shared apps/server/src/routes/coach/__tests__/projects.test.ts`. Expected: FAIL (`isRunnable` not exported; `repo` undefined).
- [ ] **Step 3: Add the types and `isRunnable`** to `packages/shared/src/coach.ts` under a `// ── Runs (website task runner)` heading, and `repo`/`siteUrl` to `toProject`.
- [ ] **Step 4: Write the migration.** Header comment naming the spec. Contents:
  - `alter table coach_projects add column if not exists repo text, add column if not exists site_url text;`
  - `alter table public.api_keys add column if not exists scope text check (scope in ('runner'));`
  - `create table if not exists coach_runs` with: `id uuid pk default gen_random_uuid()`, `user_id` → `users` cascade, `task_id` → `coach_tasks` cascade, `status text not null default 'queued' check (status in ('queued','working','done','failed','cancelled'))`, `claimed_at timestamptz`, `seen_at timestamptz`, `note text`, `summary text`, `branch text`, `pr_url text`, `preview_url text`, `pictures jsonb not null default '[]'`, `error text`, `created_at timestamptz not null default now()`, `finished_at timestamptz`.
  - `create unique index if not exists coach_runs_active_idx on coach_runs (task_id) where status in ('queued','working');`
  - `create index if not exists coach_runs_queue_idx on coach_runs (user_id, status, created_at);`
  - `alter table coach_runs enable row level security;` with the "server uses the service role" comment.
- [ ] **Step 5: Run the tests again.** Expected: PASS. Then `pnpm --filter @cliphy/shared typecheck` (or the repo's shared typecheck script), `pnpm --filter server typecheck`. Expected: clean, except new `ChatAction`/`ChatKind` members may make a `switch` in `apps/server/src/services/coach/actions.ts` non-exhaustive: add `case "start_run": case "stop_run": return NOTHING;` as a placeholder that Task 4 replaces.
- [ ] **Step 6: Commit** the five files: `add runs table, project repo fields and run types`.

### Task 2: Scoped API keys

**Files:**

- Modify: `apps/server/src/env.ts`, `apps/server/src/middleware/auth.ts`, `apps/server/src/routes/api-keys.ts`
- Test: `apps/server/src/middleware/__tests__/auth-scope.test.ts`, the existing api-keys route test

**Interfaces:**

- Produces: `AppEnv.Variables.keyScope: "runner" | null` (null for JWT and unscoped keys). `export function runnerMayCall(method: string, path: string): boolean` in `auth.ts`. `POST /keys` accepts `scope: "runner"`.

- [ ] **Step 1: Write the failing tests.**
  - `runnerMayCall("POST", p)` is true for `/coach/runs/claim`, `/coach/runs/<uuid>/checkin`, `/coach/runs/<uuid>/finish`, `/coach/intake/upload-url` and the same paths with an `/api` prefix; false for `/coach/people`, `/coach/intake/messages`, `/coach/chat`, `/coach/runs` (start), `/coach/runs/<uuid>/cancel`, `/clips`, and for `GET` on an allowed path.
  - Through the middleware with a fake `api_keys` row `{ id, user_id, scope: "runner" }`: `POST /coach/runs/claim` reaches the handler with `keyScope === "runner"`; `GET /coach/people` returns 403 `{ error: "This key cannot do that" }`. With `scope: null` both reach the handler and `keyScope === null`.
  - `POST /keys` with `{ name: "Runner", scope: "runner" }` inserts `scope: "runner"`; with `scope: "admin"` returns 400; with no scope inserts `scope: null`.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/src/middleware apps/server/src/routes/__tests__`. Expected: FAIL.
- [ ] **Step 3: Implement.** The middleware selects `id, user_id, scope`, sets `keyScope`, and refuses a runner key with 403 when `!runnerMayCall(c.req.method, c.req.path)`, before `next()`. `runnerMayCall` matches against the path with an optional leading `/api` stripped.
- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS and clean.
- [ ] **Step 5: Commit:** `let an API key be limited to the runner's calls`.

### Task 3: Run service and routes

**Files:**

- Create: `apps/server/src/services/coach/runs.ts`, `apps/server/src/routes/coach/runs.ts`
- Modify: `apps/server/src/routes/coach/index.ts` (mount at `/runs`), `apps/server/src/routes/coach/projects.ts` (PATCH accepts `repo`, `siteUrl`)
- Test: `apps/server/src/routes/coach/__tests__/runs.test.ts`, `projects.test.ts`

**Interfaces:**

- Consumes: Task 1 types, Task 2 `keyScope`, `loadTasks(userId)`, `signImageUrl(path)`, `postBotMessage`.
- Produces, in `runs.ts` service:
  ```ts
  export function toRun(row: Row): CoachRun;
  export async function startRun(
    userId: string,
    taskId: string,
  ): Promise<{ status: 201 | 200; run: CoachRun } | { status: 404 | 409; error: string }>;
  export async function cancelRun(userId: string, runId: string): Promise<CoachRun | null>;
  export async function claimRun(
    userId: string,
  ): Promise<{ run: CoachRun; brief: RunBrief } | null>;
  export async function checkInRun(
    userId: string,
    runId: string,
    note: string | null,
  ): Promise<{ cancelled: boolean } | null>;
  export async function finishRun(
    userId: string,
    runId: string,
    outcome: RunOutcome,
  ): Promise<CoachRun | null>;
  ```
- Routes (all under `/api/coach/runs`):
  | Call | Who | Result |
  |---|---|---|
  | `POST /` `{ taskId }` | JWT only; API key → 403 `{ error: "Sign in on the phone to do this" }` | 201 `{ run }`; 200 `{ run }` when one is already queued or working; 404 no such task; 409 `{ error: "This task cannot be started on the site" }` |
  | `POST /:id/cancel` | JWT only | 200 `{ run }`, 404 |
  | `GET /?taskId=` | either | 200 `{ run: CoachRun \| null }` (newest for the task; picture `url`s signed) |
  | `POST /claim` | API key only; JWT → 403 | 200 `{ run, brief }` or 200 `{ run: null }` |
  | `POST /:id/checkin` `{ note? }` | API key only | 200 `{ cancelled }`, 404 |
  | `POST /:id/finish` `RunOutcome` | API key only | 200 `{ run }`, 400 bad body, 404 |

- [ ] **Step 1: Write the failing route tests** (one `describe` per call, `makeDb` responders as in `requests.test.ts`):
  - **start:** runnable task → insert into `coach_runs` with `status: "queued"` and 201; task of kind `tell` → 409; project without `repo` → 409; blocked task → 409; insert answering Postgres `23505` → 200 with the existing active run and no second insert; API key → 403 and no database write.
  - **claim:** oldest queued run is updated with `status: "working"`, `claimed_at`, `seen_at`, guarded by `.eq("status","queued")`; when that guarded update returns no row (another runner won) the service tries the next queued run, and returns `{ run: null }` when none is left. The brief has `repo`, `siteUrl`, `understood`, `answer`, task `title` and `kit`, and the bundle's messages oldest first with `imageUrls` equal to `https://signed/<path>` for each attachment. A task whose request is null gives `understood: ""` and `messages: []`.
  - **checkin:** sets `seen_at` and `note` only where `status = 'working'`; returns `{ cancelled: true }` for a cancelled run and does not change it.
  - **finish:** `done` stores summary, branch, `pr_url`, `preview_url`, pictures, `finished_at`, guarded by `.in("status", ["queued","working"])`. A second finish, or a finish on a cancelled run, returns 200 with the stored run and writes nothing. `status: "merged"` → 400. A picture whose `storagePath` does not start with `coach/<userId>/` or contains `..` → 400. `summary` and `error` are cut to 2000 characters.
  - **cancel:** updates to `cancelled` with `finished_at`, guarded on queued/working; already finished → returned unchanged.
  - **projects PATCH:** `repo: "example/alder-house"` is stored; `repo: "not a repo"` → 400 `{ error: "repo must look like owner/name" }`; `repo: ""` stores null; `siteUrl: "alderhouse.example"` → 400 `{ error: "site address must start with https://" }`; `siteUrl: ""` stores null.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/src/routes/coach`. Expected: new tests FAIL (404 route).
- [ ] **Step 3: Implement the service and routes.** No chat messages yet (Task 4 adds them). Atomic claim is "select the oldest queued id, then update guarded on status", looped at most 3 times; there is no database function.
- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS and clean.
- [ ] **Step 5: Commit:** `add run routes: start, cancel, claim, check in, finish`.

### Task 4: Chat messages and buttons

**Files:**

- Modify: `apps/server/src/services/coach/botMessages.ts`, `actions.ts`, `runs.ts`, `apps/server/src/routes/coach/chat.ts`
- Test: `apps/server/src/services/coach/__tests__/botMessages.test.ts`, `apps/server/src/routes/coach/__tests__/chat.test.ts`, `runs.test.ts`

**Interfaces:**

- Consumes: Task 3 `startRun`, `cancelRun`, `finishRun`.
- Produces in `botMessages.ts`:
  ```ts
  export const START_ON_SITE = "Start on the site";
  export function startOnSite(taskId: string): ChatButton; // { label: START_ON_SITE, action: { type: "start_run", taskId } }
  export function runStarted(run: { id: string }, task: { id: string; title: string }): BotMessage;
  export function runFinished(run: CoachRun, task: { id: string; title: string }): BotMessage;
  export function runnerQuiet(run: { id: string }): BotMessage;
  export function didAction(text: string, buttons?: ChatButton[]): BotMessage;
  ```
  `ActionResult` gains `buttons?: ChatButton[]`; `taskUnblocked(task, opts?: { runnable?: boolean })`.
- Exact copy:
  - started: `Started on the site: "<title>"` with one button `Stop` → `stop_run`; kind `run_started`, refId run id, link to the task.
  - done: `Done: <summary>` then, each on its own line when present, `Preview: <url>` and `Pull request: <url>`; when there is no preview, the line `No preview was found.` Attachments: the `after` then `before` pictures at `phone` width (at most two).
  - failed: `That didn't work: <error>` plus `Pull request: <url>` or `Branch: <branch>` when there is one.
  - cancelled: `Stopped.`
  - quiet: `The runner doesn't seem to be on.` kind `runner_quiet`, refId run id.
  - Finished messages are kind `run_finished`, refId run id, link to the task.

- [ ] **Step 1: Write the failing tests.**
  - `botMessages`: each function above returns exactly the copy, kind, refId, buttons and attachments listed; `runFinished` with no pictures has no attachments; `taskUnblocked(task, { runnable: true })` has two buttons, `Start` then `Start on the site`.
  - `chat.test.ts`: confirming a request whose chain has a runnable `do` task (project has `repo`, task not blocked) posts the "Saved. N tasks added." line carrying the `Start on the site` button for that task; with the `do` task blocked, or no repo, the line has no buttons. Tapping a `start_run` button inserts a queued run and posts the `run_started` message, with no "did" line. Tapping `stop_run` cancels and posts `Stopped.` keyed on the run id. A `start_run` on a task that is no longer runnable says `That task can't be started on the site.` and releases the button.
  - `runs.test.ts`: `finish` posts `runFinished` once (the upsert carries `kind: "run_finished"`, `ref_id: <run id>`); a repeated finish posts nothing because nothing was updated.
  - `actions`/`tasks` tests: when a task is set done and the task waiting on it is a runnable `do`, the "is ready" message carries `Start on the site`.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/src/services/coach apps/server/src/routes/coach`. Expected: FAIL.
- [ ] **Step 3: Implement.** `confirm` in `actions.ts` loads the projects' repos once and returns `buttons`; `chat.ts` passes `result.buttons` to `didAction`. `announceUnblocked` gains the lookup. `executeAction` handles `start_run` and `stop_run` (replacing Task 1's placeholder). `startRun` posts `runStarted` on a 201 only; `finishRun` and `cancelRun` post `runFinished` only when their guarded update changed a row.
- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS and clean.
- [ ] **Step 5: Commit:** `say in Chat when a run starts, finishes or stops`.

### Task 5: Stale and unclaimed runs

**Files:**

- Create: `apps/server/src/functions/coachRuns.ts`
- Modify: `apps/server/src/app.ts` (register next to `checkIns`)
- Test: `apps/server/src/functions/__tests__/coachRuns.test.ts`

**Interfaces:**

- Produces: `export const RUN_STALE_MS = 15 * 60_000; export const RUN_UNCLAIMED_MS = 30 * 60_000;` `export async function sweepRuns(now: Date): Promise<{ failed: number; quiet: number }>;` and `export const sweepRunsJob` (Inngest, id `coach-runs-sweep`, cron `*/5 * * * *`, built like `CHECKIN_JOB`).

- [ ] **Step 1: Write the failing tests.** A `working` run whose `seen_at` is 16 minutes old is updated to `failed` with `error: "The runner stopped responding."` (guarded on `status = 'working'`) and gets a `run_finished` message; one seen 14 minutes ago is untouched. A `queued` run created 31 minutes ago gets the `runner_quiet` message and stays `queued`; one created 29 minutes ago gets nothing. Running the sweep twice posts through the same `kind` + `ref_id`, so the upsert is the only guard needed.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/src/functions/__tests__/coachRuns.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `sweepRuns` and the job.
- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS and clean.
- [ ] **Step 5: Commit:** `fail runs whose runner went quiet and say when none is on`.

### Task 6: Runner package, deciding logic

**Files:**

- Create: `apps/runner/package.json`, `tsconfig.json` (copy `apps/mac-helper`'s; name `cliphy-runner`), `src/prompt.ts`, `src/branch.ts`, `src/run.ts`
- Test: `apps/runner/src/__tests__/prompt.test.ts`, `branch.test.ts`, `run.test.ts`

**Interfaces:**

- Produces:
  ```ts
  // prompt.ts
  export const RESULT_SCHEMA: object; // { summary: string, paths: string[] }, both required
  export function buildPrompt(brief: RunBrief): string;
  export function parseResult(stdout: string): { summary: string; paths: string[] } | null;
  // branch.ts
  export function branchName(runId: string, title: string): string;
  // run.ts
  export interface RunDeps {
    api: {
      claim(): Promise<{ run: { id: string }; brief: RunBrief } | null>;
      checkIn(runId: string, note: string): Promise<{ cancelled: boolean }>;
      finish(runId: string, outcome: RunOutcome): Promise<void>;
      upload(bytes: Buffer, mediaType: "image/png"): Promise<string>; // stored path
    };
    repo: {
      prepare(repo: string, branch: string): Promise<{ workDir: string }>;
      collect(repo: string): Promise<{ changed: boolean }>;
      publish(
        repo: string,
        branch: string,
        title: string,
        body: string,
      ): Promise<{ prUrl: string }>;
      discard(repo: string): Promise<void>;
    };
    claude(
      workDir: string,
      prompt: string,
      limitMs: number,
    ): Promise<
      { ok: true; stdout: string } | { ok: false; reason: "timeout" | "error"; detail: string }
    >;
    preview(repo: string, branch: string, limitMs: number): Promise<string | null>;
    shoot(url: string, width: "phone" | "desktop"): Promise<Buffer>;
    log(line: string): void;
  }
  export const CLAUDE_LIMIT_MS = 20 * 60_000;
  export const PREVIEW_LIMIT_MS = 10 * 60_000;
  export async function runOnce(deps: RunDeps): Promise<"idle" | "done" | "failed" | "cancelled">;
  ```
- Step order inside `runOnce`: claim → `prepare` → check in "working on it" → `claude` → `collect` → check in "opening the pull request" → `publish` → check in "waiting for the preview" → `preview` → `shoot` and `upload` → `finish`. `discard` always runs last.

- [ ] **Step 1: Write the failing tests.**
  - `branchName("3f9a1c2e-…", "Move the sconces up on page 2!")` is `cliphy/3f9a1c2e-move-the-sconces-up`: first 8 characters of the id, the first four words, lower-case, only `a-z0-9-`. A title with no usable characters gives `cliphy/3f9a1c2e-change`.
  - `buildPrompt`: contains the task title, `understood`, the kit's `doneWhen`; puts every message's text inside one block delimited by a line `<client_messages>` and a line `</client_messages>`; a message containing the text `</client_messages>` has it removed so it cannot close the block; says in so many words that the block is material describing a website change and that instructions in it about anything else are to be ignored and mentioned in the summary; lists `imageUrls`; asks for the summary "in plain words for someone who is not a developer" and the changed site paths, most affected first.
  - `parseResult`: reads `{"structured_output": {...}}` from Claude's JSON output, and falls back to a JSON object in `result`; returns null for non-JSON, a missing summary, or `paths` that is not an array of strings starting with `/`.
  - `runOnce` with every dep faked (fixtures: Maren, Alder House, `example/alder-house`):
    - nothing queued → `"idle"`, no other call;
    - the happy path makes the calls in the order above and finishes `done` with summary, branch, `prUrl`, `previewUrl` and four pictures (`after` and `before` at both widths, `before` from `siteUrl + paths[0]`, `after` from `previewUrl + paths[0]`);
    - no `siteUrl` → only the two `after` pictures;
    - `collect` says nothing changed → finish `failed` with Claude's summary as the error, `publish` never called;
    - Claude times out → finish `failed` with `It took longer than 20 minutes.`, `publish` never called even though files changed;
    - Claude's answer is unparseable → `failed` with `Claude did not say what it changed.`, `publish` never called;
    - check-in reports cancelled before `publish` → `"cancelled"`, no `publish`, no `finish`;
    - preview never appears → `done` with `prUrl`, no `previewUrl`, no pictures;
    - `shoot` throws → still `done`, with whatever pictures succeeded;
    - `publish` throws → `failed` with `Could not open the pull request.`;
    - the body passed to `publish` contains the summary and the sentence `Made by the Cliphy runner for a request the owner confirmed.` and contains none of the message texts; the title is the task title;
    - `discard` is called in every case after a claim, including when a dep throws.
- [ ] **Step 2: Run** `pnpm install && pnpm exec vitest run apps/runner`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules. No Node built-ins that touch the machine in these files.
- [ ] **Step 4: Run** the tests and `pnpm --filter cliphy-runner typecheck`, `pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit:** `add the runner's deciding logic`.

### Task 7: Runner on a real machine

**Files:**

- Create: `apps/runner/src/machine.ts`, `src/preview.ts`, `src/api.ts`, `src/main.ts`, `apps/runner/README.md`
- Modify: `apps/runner/package.json` (dependency `playwright`; scripts `start`, `once`, `check`)
- Test: `apps/runner/src/__tests__/machine.test.ts`, `preview.test.ts`

**Interfaces:**

- Consumes: `RunDeps` from Task 6.
- Produces:
  ```ts
  export interface RunnerConfig {
    apiUrl: string;
    apiKey: string;
    workUser: string;
    workRoot: string;
    reposRoot: string;
  }
  export type Exec = (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  export function claudeArgs(prompt: string): string[];
  export function createRepo(config: RunnerConfig, exec: Exec): RunDeps["repo"];
  export function previewFromDeployments(
    deployments: unknown,
    statuses: (id: number) => Promise<unknown>,
  ): Promise<string | null>;
  ```
- **How the two users are kept apart (decided here):** the runner's user keeps its own clone at `<reposRoot>/<owner>__<name>`. `prepare` fetches, checks out the new branch from the default branch tip there, then copies the tree **without `.git`** to `<workRoot>/<owner>__<name>` and hands that folder to the work user. Claude and every build command run there as the work user (`sudo -n -u <workUser> -H …`). `collect` copies the folder back over the runner's clone with `rsync -a --delete --exclude .git --exclude node_modules`, then asks `git status --porcelain` whether anything changed. `publish` commits with `git -c core.hooksPath=/dev/null -c core.fsmonitor=false commit`, pushes only `refs/heads/cliphy/*`, and runs `gh pr create --draft` (retrying without `--draft` when GitHub says drafts are not supported). Nothing the work user can write is ever executed or read as configuration by the runner's user.

- [ ] **Step 1: Write the failing tests** with a recording fake `Exec`:
  - `claudeArgs(p)` includes `-p`, `--output-format json`, `--json-schema <RESULT_SCHEMA as JSON>`, `--permission-mode dontAsk`, a `--tools` list of exactly `Read,Edit,Write,Glob,Grep,Bash`, an `--allowedTools` list holding the file tools plus `Bash(pnpm *)`, `Bash(npm *)`, `Bash(yarn *)`, `Bash(bun *)`, `Bash(npx *)`, `Bash(node *)`, and a `--disallowedTools` list holding `WebFetch`, `WebSearch`, `Bash(git push *)`, `Bash(gh *)`, `Bash(curl *)`, `Bash(wget *)`; the prompt is the last argument and is passed as an argument, never through a shell.
  - `prepare("example/alder-house", branch)`: the copy to the work folder excludes `.git`; a repo name failing `REPO_PATTERN` throws before any command runs.
  - `collect`: the rsync back excludes `.git` and `node_modules`; `changed` follows `git status --porcelain` output.
  - `publish`: the commit carries `core.hooksPath=/dev/null`; the push refspec is `HEAD:refs/heads/<branch>` and a branch not starting `cliphy/` throws before any command; `--draft` is tried first and dropped on the "Draft pull requests are not supported" error; the returned `prUrl` is the trimmed `gh` output.
  - Every command that runs in the work folder is prefixed `sudo -n -u <workUser> -H`; no git or gh command is.
  - `previewFromDeployments`: given the GitHub deployments list for the branch and a statuses lookup, returns the `environment_url` of the newest deployment whose latest status is `success`; null when there is none, when the newest is still `in_progress`, or when the URL is not `https://`.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/runner`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `preview.ts` polls `gh api repos/<repo>/deployments?ref=<branch>` every 15 s through `previewFromDeployments` until the limit. `shoot` uses Playwright Chromium, first screen only, at 390×844 (phone) and 1280×800 (desktop), PNG. `api.ts` mirrors `apps/mac-helper/src/api.ts` for the three calls plus upload. `main.ts`: `run` loops `runOnce` every 20 s when idle, checking in every 60 s while Claude works; `once` runs one cycle; `check` prints, for each of these, a pass or the fix: config file readable only by its owner, `gh auth status`, `sudo -n -u <workUser> true`, the work user can run `claude --version`, the work user **cannot** read the config file, Chromium installed. Config lives at `~/.cliphy-runner/config.json`.
- [ ] **Step 4: Check the flags against the installed CLI.** Run `claude --help` and confirm every flag in `claudeArgs` is listed. This CLI (2.1.325) lists no `--max-turns`; the wall-clock limit is the only cap unless the devbox's version has one, in which case add `--max-turns 60`. In a throwaway folder containing one `index.html`, run the exact `claudeArgs` with the prompt "Change the heading to Hello" and confirm: the file changed, the output parses with `parseResult`, and a prompt asking it to `curl example.com` is refused. Expected: all three hold; fix the lists if not.
- [ ] **Step 5: Run** tests, typecheck, lint. Expected: PASS and clean.
- [ ] **Step 6: Write `README.md`** in the style of the Mac helper's: what it does, the three commands, where the config lives.
- [ ] **Step 7: Commit:** `run Claude Code, git and the pull request from the runner`.

### Task 8: Phone

**Files:**

- Modify: `apps/mobile/lib/coach.ts`, `lib/coachApi.ts`, `app/(tabs)/chat.tsx`, `app/coach/project/[id].tsx`, `app/coach/task/[id].tsx`, `app/coach/setup.tsx`
- Test: `apps/mobile/lib/__tests__/coach.test.ts`

**Interfaces:**

- Consumes: Task 1 types and `isRunnable`; Task 3 routes; `POST /keys` with `scope`.
- Produces in `lib/coach.ts`:

  ```ts
  export function textParts(text: string): { text: string; url?: string }[]; // splits out https:// links
  export function runLine(run: CoachRun | null): string | null;
  ```

  In `coachApi.ts`: `updateProject(id, body: { repo?: string; siteUrl?: string })`, `getRun(taskId)`, `startRun(taskId)`, `cancelRun(runId)`, `createRunnerKey(): Promise<{ key: string }>`.

- [ ] **Step 1: Write the failing tests.** `textParts("Preview: https://a.example/x\nPull request: https://github.com/example/alder-house/pull/3")` gives four parts with the two URLs marked, and a trailing full stop or bracket is not part of a URL; text with no link is one part. `runLine`: null → null; queued → `Waiting for the runner.`; working with a note → `Working: <note>`; working without → `Working on it.`; done → `Done. See Chat for the result.`; failed → `That didn't work: <error>`; cancelled → `Stopped.`
- [ ] **Step 2: Run** `pnpm exec vitest run apps/mobile`. Expected: FAIL.
- [ ] **Step 3: Implement the helpers and API calls**, then the screens:
  - **Chat:** bot text is drawn through `textParts`; a link part opens with `Linking.openURL`. Buttons with `start_run` and `stop_run` need no client handling beyond the existing `chooseButton`.
  - **Project screen:** two text fields under the project's name, labelled `Website repo` (placeholder `owner/name`) and `Live site` (placeholder `https://`), saved on blur through `updateProject`; the server's 400 message is shown under the field.
  - **Task screen:** when `isRunnable(task, project)`, a `Start on the site` button; the line from `runLine` under it; while a run is queued or working the button reads `Stop` and the run is re-read every 5 s.
  - **Setup screen:** a row `Runner key` with a `Make key` button that shows the key once with a `Copy` button and the line `Shown once. Put it in the runner's config.`
- [ ] **Step 4: Run** tests, `pnpm --filter mobile typecheck` (use the package's real name), `pnpm lint`. Expected: PASS and clean.
- [ ] **Step 5: Commit:** `start a run and see its result from the phone`. Pushing this publishes an over-the-air update; that is fine before the migration is applied because every new control is hidden until a project has a repo, which cannot be saved until then.

### Task 9: ADR and setup page

**Files:**

- Create: `docs/decisions/0062-devbox-poller-running-claude-code-headless.md`, `docs/runner-setup.md`
- Modify: `docs/providers.md` (GitHub fine-grained token; no new paid service), `docs/architecture.md` (one paragraph and the three calls)

- [ ] **Step 1: Read** `docs/.lore/types/decision.schema.yaml` and write the ADR: the choice, options B (GitHub Actions in each client repo) and C (hosted sandbox through the API) not taken, and the tradeoffs from the spec, including the accepted exposure of the Claude login.
- [ ] **Step 2: Write `docs/runner-setup.md`**, steps in order, each with the command and what success looks like:
  1. two users on the devbox (`cliphy-runner`, `cliphy-work`), home folders `0700`;
  2. the sudoers line letting `cliphy-runner` run commands as `cliphy-work` without a password, and nothing the other way;
  3. `workRoot` owned by `cliphy-work`, `reposRoot` owned by `cliphy-runner`;
  4. Node 22, `gh`, `claude`, Playwright Chromium;
  5. `claude` logged in as `cliphy-work`;
  6. the fine-grained GitHub token on Suzi's account, limited to the chosen repos, contents and pull requests read/write, given to `gh` as `cliphy-runner`;
  7. branch protection on each client repo's default branch, with the reason;
  8. the runner key from the phone's Setup screen into `~/.cliphy-runner/config.json`, mode `0600`;
  9. `pnpm --filter cliphy-runner check`;
  10. the systemd user service file in full and `loginctl enable-linger`;
  11. adding a repo: set `Website repo` and `Live site` on the project in the phone.
- [ ] **Step 3: Run** `lore reindex decision && lore validate decision`. Expected: no errors.
- [ ] **Step 4: Commit:** `document the runner: decision and devbox setup`.

### Task 10: The real run (needs Suzi)

Nothing in this task is done without her say-so at each numbered point.

- [ ] **Step 1: Ask before applying `045_coach_runs.sql` to production.** It only adds two nullable columns to `coach_projects`, one nullable column to `api_keys` and a new table. After it is applied, confirm with a read-only query that `coach_runs` exists and `api_keys.scope` is null for every existing key.
- [ ] **Step 2: Set up the devbox** by following `docs/runner-setup.md` exactly, fixing the page wherever it is wrong. `check` must pass every line.
- [ ] **Step 3: Make the scratch site.** A small static site repo for "Alder House" on Suzi's GitHub, deployed on Cloudflare with previews on. Note whether it is Pages or Workers; if deployments do not show up through `gh api repos/<repo>/deployments`, change `preview.ts` to read what Cloudflare does report and add a test for that shape.
- [ ] **Step 4: Run one for real.** Create the project with its repo and live site, type a request by hand ("Maren asked for the opening hours to move above the map"), confirm it, tap `Start on the site`. Expected in Chat: the started message, then within about 15 minutes the done message with two pictures, a preview link that opens, and a draft pull request that contains none of the request's message text.
- [ ] **Step 5: Run one that cannot work** ("change the price on page 9"). Expected: `That didn't work: …` in plain words and no branch on GitHub.
- [ ] **Step 6: Tap Stop on a third run** while it is working. Expected: `Stopped.` and no pull request.
- [ ] **Step 7: Write the devlog** with `/devlog`, put any platform lesson (Cloudflare previews, headless Claude flags, sudo between users) in `~/dev/wiki`, and commit.
