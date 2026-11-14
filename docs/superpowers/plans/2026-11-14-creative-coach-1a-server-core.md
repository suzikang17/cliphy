---
date: 2026-11-14
title: Creative coach 1a, plan 1 — server core (people, intake, requests, tasks)
---

# Creative Coach 1a, Plan 1 — Server Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Captured messages posted to the API become confirmed requests with history and a chain of do/tell/ask/get tasks, all reachable over HTTP.

**Architecture:** New tables and `/coach/*` Hono routes behind a per-account switch. Messages are grouped into bundles; an Inngest function debounces each bundle, asks Claude for a structured interpretation, validates it with a pure parser and stores a request. Confirming a request materializes its task chain. All decision logic lives in pure functions under `services/coach/` so it is tested without the database.

**Tech Stack:** Hono, Supabase (service role), Inngest v4, `@anthropic-ai/sdk`, Vitest, `@cliphy/shared`.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md`

## Where this plan sits

The spec's 1a is five subsystems. Each gets its own plan and each ends in working, testable software. This is plan 1.

| Plan                      | Delivers                                                                                         | Depends on |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| **1. Server core (this)** | people, projects, intake, requests with history, tasks                                           | —          |
| 2. Reminders and push     | reminder scheduling, sending, delivery reports, re-fire, weekly review                           | 1          |
| 3. Chat bot               | the chat thread, bot tools, learned rules, filing tiers                                          | 1, 2       |
| 4. Phone app              | Library/plus/Chat bar, Chat, request page, Up next, project history, "Send to Chat" share, Setup | 1–3        |
| 5. Mac helper             | background script reading Messages, per-person history window, heartbeat                         | 1          |
| 6. 1b                     | working hours, check-ins, focus, progress photos                                                 | 1–4        |

Not in this plan: reminders, notifications, the chat thread, learned rules, any phone or Mac code.

## Global Constraints

- TypeScript strict. Server imports use the `.js` suffix (`"../lib/supabase.js"`).
- Tests are Vitest, colocated in `__tests__/`, and follow the mocking style of `apps/server/src/routes/__tests__/notes.test.ts` (`mockChain`, mocked `authMiddleware`, `allure-js-commons` labels).
- Run tests from the repo root: `pnpm vitest run <path>`. Typecheck: `pnpm -C apps/server typecheck`. Lint: `pnpm lint`.
- Migrations are single numbered SQL files in `apps/server/supabase/migrations/`. Apply to a database with `psql "$DATABASE_URL" -f <file>`; never `supabase db push`.
- New tables: `enable row level security`, no policies (server uses the service role), `user_id uuid not null references users(id) on delete cascade`.
- Every `/coach/*` route requires auth and the per-account switch. Accounts without it get `403 {"error":"coach_not_enabled"}`.
- The repo is public. Fixtures and tests use the fictional client "Maren" and project "Alder House" only. No real client names, quotes or copy.
- Bot-written text follows the spec's copy rules: `understood` is at most two sentences and keeps who asked, what for and by when; a question has at most 3 options of at most 2 words each.
- A person is `client`, `collaborator` or `both`. The role is a label; no behaviour branches on it.
- Nothing is deleted when a request is replaced.
- Commit to `main`, imperative mood, one commit per task. End commit messages with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Interpretation model: `claude-opus-5-5` (amended during execution: the API guide defaults to it, and forced tool calls are rejected by current models, so the call uses `tool_choice: auto` plus an instruction). Load the `claude-api` skill before writing the Anthropic call.

## Review Focus

1. **The same message is uploaded twice** (the helper retries after a timeout): one stored message, one bundle, one request. Pinned in Task 4.
2. **A bundle with attachments and no text** (two screenshots, nothing typed): still interpreted, not skipped as empty. Pinned in Task 5.
3. **The model returns an id that does not exist or belongs to another account** (project, request to replace, task replied to): the id is dropped to null and never written. Pinned in Task 5.
4. **Confirm is tapped twice**: the task chain is created once; the second call changes nothing. Pinned in Task 7.
5. **The model call fails or times out**: the messages stay stored, the bundle is marked `failed`, and a later message or retry processes it. Pinned in Task 6.

## File Structure

| File                                                                      | Responsibility                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/server/supabase/migrations/038_coach_core.sql`                      | switch column and the seven tables                  |
| `packages/shared/src/coach.ts`                                            | types and constants shared with the phone app       |
| `apps/server/src/middleware/require-coach.ts`                             | the per-account switch                              |
| `apps/server/src/lib/coachMappers.ts`                                     | row → API shape for coach tables                    |
| `apps/server/src/services/coach/bundling.ts`                              | pure: which bundle a message joins                  |
| `apps/server/src/services/coach/interpret.ts`                             | prompt, Claude call, pure `parseInterpretation`     |
| `apps/server/src/services/coach/chain.ts`                                 | pure: proposed chain → task rows; blocked; sent     |
| `apps/server/src/services/coach/history.ts`                               | pure: requests → project history                    |
| `apps/server/src/services/coach/projects.ts`                              | seed projects from `project:` tags                  |
| `apps/server/src/services/imageClip.ts`                                   | `createImageClip`, extracted from `routes/clips.ts` |
| `apps/server/src/functions/processBundle.ts`                              | Inngest: debounce, interpret, store                 |
| `apps/server/src/routes/coach/{people,projects,intake,requests,tasks}.ts` | HTTP                                                |
| `apps/server/src/routes/coach/index.ts`                                   | mounts the five under `/coach`                      |
| `apps/server/eval/fixtures/coach/alder-house.json`                        | the proof fixture                                   |

---

### Task 1: Schema, shared types and the switch

**Files:**

- Create: `apps/server/supabase/migrations/038_coach_core.sql`, `packages/shared/src/coach.ts`, `apps/server/src/middleware/require-coach.ts`, `apps/server/src/lib/coachMappers.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./coach";`)
- Test: `apps/server/src/middleware/__tests__/require-coach.test.ts`, `apps/server/src/lib/__tests__/coachMappers.test.ts`

**Interfaces — Produces:**

```ts
// packages/shared/src/coach.ts
export type PersonRole = "client" | "collaborator" | "both";
export type HistoryWindow = "new" | "window" | "all";
export type Channel = "imessage" | "sms" | "share";
export type Direction = "in" | "out";
export type BundleStatus = "collecting" | "processing" | "done" | "failed";
export type BundleKind = "request" | "reply" | "chat";
export type RequestStatus = "new" | "confirmed" | "replaced" | "closed";
export type TaskKind = "do" | "tell" | "ask" | "get";
export type TaskState = "open" | "waiting" | "done" | "dropped";

export const BUNDLE_QUIET_MS = 180_000;
export const MAX_QUESTION_OPTIONS = 3;

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  handles: string[];
  captureThread: boolean;
  historyWindow: HistoryWindow;
  historyDays: number | null;
}
export interface Project {
  id: string;
  name: string;
  tag: string;
  active: boolean;
  stateLine: string;
  personIds: string[];
}
export interface Attachment {
  storagePath: string;
  mediaType: string;
  url?: string;
  clipId?: string;
}
export interface InboundMessage {
  id: string;
  personId: string;
  channel: Channel;
  direction: Direction;
  text: string;
  attachments: Attachment[];
  sentAt: string;
}
export interface OpenQuestion {
  text: string;
  options: string[];
}
export interface ChecklistItem {
  text: string;
  done: boolean;
}
export interface TaskKit {
  materials?: string[];
  target?: string;
  doneWhen?: string;
  draft?: string;
}
export interface ProposedTask {
  kind: TaskKind;
  title: string;
  withPerson: boolean;
  after: number | null;
  answersQuestion: boolean;
  kit: TaskKit;
}
export interface CoachRequest {
  id: string;
  bundleId: string;
  projectId: string | null;
  personId: string;
  understood: string;
  openQuestion: OpenQuestion | null;
  answer: string | null;
  status: RequestStatus;
  replacesId: string | null;
  proposedReplacesId: string | null;
  proposedTasks: ProposedTask[];
  dueDate: string | null;
  historical: boolean;
  createdAt: string;
  confirmedAt: string | null;
}
export interface CoachTask {
  id: string;
  requestId: string | null;
  projectId: string | null;
  kind: TaskKind;
  state: TaskState;
  title: string;
  kit: TaskKit;
  withPersonId: string | null;
  afterTaskId: string | null;
  blocked: boolean;
  dueDate: string | null;
  dueTime: string | null;
  place: string | null;
  checklist: ChecklistItem[];
  replyBundleId: string | null;
  createdAt: string;
  doneAt: string | null;
}
```

```ts
// apps/server/src/middleware/require-coach.ts
export const requireCoach: MiddlewareHandler<AppEnv>;
// apps/server/src/lib/coachMappers.ts — snake_case row → the shared type
export function toPerson(row: Record<string, unknown>): Person;
export function toProject(row: Record<string, unknown>, personIds: string[]): Project;
export function toMessage(row: Record<string, unknown>): InboundMessage;
export function toRequest(row: Record<string, unknown>): CoachRequest;
export function toTask(row: Record<string, unknown>, blocked: boolean): CoachTask;
```

**Tables** (columns beyond `id uuid primary key default gen_random_uuid()`, `user_id`, `created_at timestamptz not null default now()`):

| Table                  | Columns                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users` (alter)        | `coach_enabled boolean not null default false`                                                                                                                                                                                                                                                                                                                                       |
| `coach_people`         | `name text not null`, `role text not null check (role in ('client','collaborator','both'))`, `handles text[] not null default '{}'`, `capture_thread boolean not null default false`, `history_window text not null default 'new' check (...)`, `history_days int`                                                                                                                   |
| `coach_projects`       | `name text not null`, `tag text not null`, `active boolean not null default true`, `state_line text not null default ''`, `unique (user_id, tag)`                                                                                                                                                                                                                                    |
| `coach_project_people` | `project_id`, `person_id`, primary key on both, both `on delete cascade`; no `id`/`user_id`                                                                                                                                                                                                                                                                                          |
| `coach_bundles`        | `person_id` → people, `status text not null default 'collecting'`, `kind text`, `last_message_at timestamptz not null`, `historical boolean not null default false`, `fix_note text`                                                                                                                                                                                                 |
| `coach_messages`       | `person_id`, `bundle_id` (nullable), `channel`, `direction`, `external_id text not null`, `text text not null default ''`, `attachments jsonb not null default '[]'`, `sent_at timestamptz not null`, `unique (user_id, channel, external_id)`                                                                                                                                       |
| `coach_requests`       | `bundle_id`, `person_id`, `project_id` (nullable), `understood text not null`, `open_question jsonb`, `answer text`, `status text not null default 'new'`, `replaces_id` → requests, `proposed_replaces_id` → requests, `proposed_tasks jsonb not null default '[]'`, `due_date date`, `historical boolean not null default false`, `confirmed_at timestamptz`, `unique (bundle_id)` |
| `coach_tasks`          | `request_id`, `project_id`, `kind`, `state text not null default 'open'`, `title text not null`, `kit jsonb not null default '{}'`, `with_person_id`, `after_task_id` → tasks, `due_date date`, `due_time time`, `place text`, `checklist jsonb not null default '[]'`, `reply_bundle_id` → bundles, `position int not null default 0`, `done_at timestamptz`                        |

Add check constraints for every enum column using the shared type's values. Index `coach_messages (bundle_id)`, `coach_bundles (user_id, person_id, status)`, `coach_requests (user_id, project_id, created_at desc)`, `coach_tasks (user_id, state)`.

- [ ] **Step 1: Write the failing tests**

```ts
// require-coach.test.ts
it("403s with coach_not_enabled when the account's switch is off", async () => {
  supabaseMock.from = vi.fn(() => mockChain({ data: { coach_enabled: false }, error: null }));
  const res = await app().request("/x");
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "coach_not_enabled" });
});
it("passes through when the switch is on", async () => {
  supabaseMock.from = vi.fn(() => mockChain({ data: { coach_enabled: true }, error: null }));
  expect((await app().request("/x")).status).toBe(200);
});

// coachMappers.test.ts
it("maps a task row and carries the computed blocked flag", () => {
  const t = toTask(
    {
      id: "t1",
      kind: "do",
      state: "open",
      title: "Replace page 2 copy",
      kit: { doneWhen: "New copy is live" },
      after_task_id: "t0",
      checklist: [],
      due_date: "2026-11-18",
      due_time: null,
      created_at: "2026-11-14T09:44:00Z",
    },
    true,
  );
  expect(t).toMatchObject({
    kind: "do",
    afterTaskId: "t0",
    blocked: true,
    dueDate: "2026-11-18",
    kit: { doneWhen: "New copy is live" },
  });
});
it("defaults a request's proposedTasks and openQuestion", () => {
  const r = toRequest({
    id: "r1",
    bundle_id: "b1",
    person_id: "p1",
    understood: "x",
    status: "new",
  });
  expect(r.proposedTasks).toEqual([]);
  expect(r.openQuestion).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run apps/server/src/middleware/__tests__/require-coach.test.ts apps/server/src/lib/__tests__/coachMappers.test.ts` → FAIL, modules not found.
- [ ] **Step 3: Write the migration, `coach.ts`, the export line, `requireCoach` (reads `users.coach_enabled` for `c.get("userId")`), and the mappers.**
- [ ] **Step 4: Run the tests and `pnpm -C apps/server typecheck`** → PASS, no type errors.
- [ ] **Step 5: Apply the migration to the local database** — `psql "$DATABASE_URL" -f apps/server/supabase/migrations/038_coach_core.sql`, then `psql "$DATABASE_URL" -c '\dt coach_*'` lists seven tables. If no local database is configured, say so in the task report and do not apply to production.
- [ ] **Step 6: Commit** — `add coach core schema, shared types and account switch`

---

### Task 2: People and projects API

**Files:**

- Create: `apps/server/src/routes/coach/people.ts`, `apps/server/src/routes/coach/projects.ts`, `apps/server/src/routes/coach/index.ts`, `apps/server/src/services/coach/projects.ts`
- Modify: `apps/server/src/app.ts` (`app.route("/coach", coachRoutes)` after the `/trail` line)
- Test: `apps/server/src/routes/coach/__tests__/people.test.ts`, `.../projects.test.ts`, `apps/server/src/services/coach/__tests__/projects.test.ts`

**Interfaces:**

- Consumes: Task 1 types, mappers, `requireCoach`.
- Produces:
  - `coachRoutes` (`index.ts`): applies `authMiddleware` then `requireCoach` to `*`, mounts `/people`, `/projects` (later tasks add `/intake`, `/requests`, `/tasks`).
  - `GET /coach/people` → `{ people: Person[] }`; `POST /coach/people` `{ name, role, handles?, captureThread?, historyWindow?, historyDays? }` → `201 { person }`; `PATCH /coach/people/:id` same fields, all optional → `{ person }`.
  - `GET /coach/projects` → `{ projects: Project[] }`; `POST /coach/projects` `{ name, personIds? }` → `201 { project }`; `PATCH /coach/projects/:id` `{ name?, active?, stateLine?, personIds? }`; `POST /coach/projects/seed` → `{ created: number }`.
  - `export function projectTag(name: string): string` — `"project:" + slug`, slug is lowercase, non-alphanumerics collapsed to `-`, trimmed of `-`.
  - `export function projectNameFromTag(tag: string): string` — `"project:alder-house"` → `"Alder house"`.
  - `export async function seedProjectsFromTags(userId: string): Promise<number>` — reads tags starting `project:` from `tag_hints` and from `clips.tags`, upserts one `coach_projects` row per tag with `onConflict: "user_id,tag", ignoreDuplicates: true`, returns the number inserted.

Validation: `name` trimmed and non-empty (400 `name is required`); `role` must be a `PersonRole` (400 `role must be client, collaborator or both`); `historyWindow: "window"` requires a positive integer `historyDays` (400 `historyDays is required for a window`). `POST /coach/projects` returns 409 `project already exists` when the tag collides.

- [ ] **Step 1: Write the failing tests**

```ts
// services projects.test.ts
it("slugs a project name into a project: tag", () => {
  expect(projectTag("  Alder House!  ")).toBe("project:alder-house");
});
it("turns a tag back into a readable name", () => {
  expect(projectNameFromTag("project:alder-house")).toBe("Alder house");
});

// people.test.ts
it("rejects a role outside client/collaborator/both", async () => {
  const res = await post("/api/coach/people", { name: "Maren", role: "vendor" });
  expect(res.status).toBe(400);
});
it("requires historyDays when the window is 'window'", async () => {
  const res = await post("/api/coach/people", {
    name: "Maren",
    role: "client",
    historyWindow: "window",
  });
  expect(res.status).toBe(400);
});
it("creates a person who is both client and collaborator", async () => {
  supabaseMock.from = vi.fn(() => mockChain({ data: personRow({ role: "both" }), error: null }));
  const res = await post("/api/coach/people", { name: "Maren", role: "both" });
  expect(res.status).toBe(201);
  expect((await res.json()).person.role).toBe("both");
});

// projects.test.ts
it("seed reports how many projects were created from project: tags", async () => {
  seedMock.mockResolvedValue(2);
  const res = await post("/api/coach/projects/seed", {});
  expect(await res.json()).toEqual({ created: 2 });
});
it("409s when a project with the same tag exists", async () => {
  supabaseMock.from = vi.fn(() => mockChain({ data: null, error: { code: "23505" } }));
  expect((await post("/api/coach/projects", { name: "Alder House" })).status).toBe(409);
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement the service, the two route files, `index.ts`, and mount in `app.ts`.**
- [ ] **Step 4: Run the tests, typecheck and lint** → PASS.
- [ ] **Step 5: Commit** — `add coach people and projects endpoints`

---

### Task 3: Bundling rule

**Files:**

- Create: `apps/server/src/services/coach/bundling.ts`
- Test: `apps/server/src/services/coach/__tests__/bundling.test.ts`

**Interfaces — Produces:**

```ts
export interface OpenBundle {
  id: string;
  status: BundleStatus;
  lastMessageAt: string;
}
/** "append" joins `open`; "new" starts a bundle. Outgoing messages never bundle. */
export function pickBundle(
  open: OpenBundle | null,
  direction: Direction,
  sentAt: string,
  quietMs?: number,
): "append" | "new" | "none";
```

Rules: `direction === "out"` → `"none"`. No open bundle, or its status is not `collecting` → `"new"`. Otherwise `"append"` when `|sentAt − lastMessageAt| <= quietMs` (default `BUNDLE_QUIET_MS`), else `"new"`. The absolute difference means a message that arrives out of order still joins.

- [ ] **Step 1: Write the failing tests**

```ts
const open = { id: "b1", status: "collecting" as const, lastMessageAt: "2026-11-14T09:42:00Z" };
it("appends a message sent within the quiet window", () => {
  expect(pickBundle(open, "in", "2026-11-14T09:43:30Z")).toBe("append");
});
it("starts a new bundle after the quiet window", () => {
  expect(pickBundle(open, "in", "2026-11-14T09:45:01Z")).toBe("new");
});
it("appends an out-of-order message that is earlier but inside the window", () => {
  expect(pickBundle(open, "in", "2026-11-14T09:41:10Z")).toBe("append");
});
it("starts a new bundle when the open one is already processing", () => {
  expect(pickBundle({ ...open, status: "processing" }, "in", "2026-11-14T09:42:30Z")).toBe("new");
});
it("never bundles an outgoing message", () => {
  expect(pickBundle(open, "out", "2026-11-14T09:42:30Z")).toBe("none");
});
it("starts a new bundle when there is none", () => {
  expect(pickBundle(null, "in", "2026-11-14T09:42:30Z")).toBe("new");
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `pickBundle`.**
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** — `add coach bundling rule`

---

### Task 4: Intake endpoints

**Files:**

- Create: `apps/server/src/routes/coach/intake.ts`
- Modify: `apps/server/src/routes/coach/index.ts` (mount `/intake`)
- Test: `apps/server/src/routes/coach/__tests__/intake.test.ts`

**Interfaces:**

- Consumes: `pickBundle`, `inngest`, Task 1 types.
- Produces:
  - `POST /coach/intake/upload-url` `{ mediaType }` → `{ path, signedUrl, token }`. Path is `coach/<userId>/<uuid>.<ext>` in the existing `clip-images` bucket, via `supabase.storage.from("clip-images").createSignedUploadUrl(path)`. Allowed media types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`; anything else 400 `unsupported media type`.
  - `POST /coach/intake/messages` `{ personId, channel, historical?, messages: [{ externalId, direction, text?, sentAt, attachments?: [{ storagePath, mediaType }] }] }` → `{ stored: number, duplicates: number, bundleIds: string[] }`.
  - Event sent once per touched bundle: `{ name: "coach/bundle.touched", data: { bundleId, userId } }`.

Behaviour of `/messages`: at most 200 messages per call (400 `too many messages`); the person must belong to the user (404 `person not found`); attachment `storagePath` must start with `coach/<userId>/` (400 `invalid attachment path`). Process messages in `sentAt` order. Insert each with `upsert(..., { onConflict: "user_id,channel,external_id", ignoreDuplicates: true })`; a row that already existed counts as a duplicate and touches nothing. For each newly stored message call `pickBundle` against the person's most recent bundle: `append` sets `bundle_id` and updates `last_message_at` to the later of the two times; `new` inserts a bundle (`historical` from the request body) and uses it; `none` stores the message with `bundle_id` null.

- [ ] **Step 1: Write the failing tests**

```ts
it("stores two messages sent a minute apart in one bundle and sends one event", async () => {
  const res = await post("/api/coach/intake/messages", {
    personId: "p1",
    channel: "imessage",
    messages: [
      {
        externalId: "m1",
        direction: "in",
        sentAt: "2026-11-14T09:42:00Z",
        attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
      },
      {
        externalId: "m2",
        direction: "in",
        text: "I like the writing on page 1 more than page 2",
        sentAt: "2026-11-14T09:43:00Z",
      },
    ],
  });
  const body = await res.json();
  expect(body).toMatchObject({ stored: 2, duplicates: 0 });
  expect(body.bundleIds).toHaveLength(1);
  expect(inngestSend).toHaveBeenCalledTimes(1);
  expect(inngestSend).toHaveBeenCalledWith(
    expect.objectContaining({ name: "coach/bundle.touched" }),
  );
});
// Review Focus 1
it("stores nothing and sends no event when the same messages are uploaded again", async () => {
  mockAllUpsertsAsDuplicates();
  const res = await post("/api/coach/intake/messages", sameBatch);
  expect(await res.json()).toEqual({ stored: 0, duplicates: 2, bundleIds: [] });
  expect(inngestSend).not.toHaveBeenCalled();
});
it("stores an outgoing message without a bundle and sends no event", async () => {
  const res = await post("/api/coach/intake/messages", {
    personId: "p1",
    channel: "imessage",
    messages: [
      { externalId: "m3", direction: "out", text: "On it", sentAt: "2026-11-14T10:00:00Z" },
    ],
  });
  expect((await res.json()).bundleIds).toEqual([]);
  expect(inngestSend).not.toHaveBeenCalled();
});
it("rejects an attachment path outside the caller's folder", async () => {
  const res = await post("/api/coach/intake/messages", {
    personId: "p1",
    channel: "imessage",
    messages: [
      {
        externalId: "m4",
        direction: "in",
        sentAt: "2026-11-14T10:00:00Z",
        attachments: [{ storagePath: "coach/someone-else/a.png", mediaType: "image/png" }],
      },
    ],
  });
  expect(res.status).toBe(400);
});
it("404s for a person that is not the caller's", async () => {
  mockPersonLookup(null);
  expect((await post("/api/coach/intake/messages", sameBatch)).status).toBe(404);
});
it("refuses an unsupported media type for an upload url", async () => {
  expect(
    (await post("/api/coach/intake/upload-url", { mediaType: "application/pdf" })).status,
  ).toBe(400);
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement the two routes and mount them.**
- [ ] **Step 4: Run the tests, typecheck, lint** → PASS.
- [ ] **Step 5: Commit** — `add coach intake endpoints`

---

### Task 5: Interpretation

**Files:**

- Create: `apps/server/src/services/coach/interpret.ts`, `apps/server/eval/fixtures/coach/alder-house.json`
- Test: `apps/server/src/services/coach/__tests__/interpret.test.ts`

**Interfaces — Produces:**

```ts
export interface InterpretContext {
  person: { id: string; name: string };
  today: string; // YYYY-MM-DD, the user's date
  projects: { id: string; name: string; hints: string }[];
  recentRequests: { id: string; projectId: string | null; understood: string }[];
  waitingAsks: { id: string; title: string }[]; // ask tasks waiting on this person
  fixNote: string | null;
}
export interface Interpretation {
  kind: BundleKind;
  understood: string;
  projectId: string | null;
  newProjectName: string | null;
  question: OpenQuestion | null;
  replacesRequestId: string | null;
  repliesToTaskId: string | null;
  dueDate: string | null;
  tasks: ProposedTask[];
}
export const INTERPRET_MODEL = "claude-opus-5-5";
export function buildInterpretMessages(
  messages: InboundMessage[],
  images: { bytes: Buffer; mediaType: string }[],
  ctx: InterpretContext,
): Anthropic.MessageParam[];
/** Pure. Never throws: unusable input becomes { kind: "chat", ... } with empty fields. */
export function parseInterpretation(raw: unknown, ctx: InterpretContext): Interpretation;
export async function interpretBundle(
  messages: InboundMessage[],
  images: { bytes: Buffer; mediaType: string }[],
  ctx: InterpretContext,
): Promise<Interpretation>;
```

`interpretBundle` makes one call offering a single tool, `record_interpretation`, whose input schema mirrors `Interpretation`, with `tool_choice: { type: "auto" }` and a system instruction to always call it; a response with no tool call or a refusal throws. The tool input goes through `parseInterpretation`. The system prompt states: the four task kinds and that a task has exactly one; one request becomes a short chain; ask at most one question and only when the request is truly ambiguous; the copy rules from Global Constraints; propose `replacesRequestId` only when the new request targets the same thing on the same project; `kind: "reply"` when the bundle answers a waiting ask; `kind: "chat"` for anything that asks for nothing.

`buildInterpretMessages` puts each image as an image block followed by the texts in time order, each prefixed with the sender's name and time. A bundle with no text still produces a user message containing the image blocks and the line `(no text was sent with these)`.

`parseInterpretation` rules:

- `kind` not one of the three → `"chat"`.
- `projectId` not in `ctx.projects` → null. `replacesRequestId` not in `ctx.recentRequests` → null. `repliesToTaskId` not in `ctx.waitingAsks` → null.
- `question.options` trimmed, empties dropped, cut to `MAX_QUESTION_OPTIONS`; a question with empty text → null.
- `dueDate` kept only if it matches `YYYY-MM-DD` and is not before `ctx.today`.
- Each task: `kind` must be a `TaskKind` or the task is dropped; `title` trimmed, empty → dropped; `after` kept only if it is an integer index lower than the task's own index among the kept tasks, else null; at most one task has `answersQuestion: true` (later ones set false), and none when `question` is null.
- `kind !== "request"` → `tasks: []`, `question: null`, `replacesRequestId: null`.

The fixture `alder-house.json` holds: person Maren; one project `Alder House`; one recent request `{ id: "r-2022", understood: "Maren asked for the Alder House page 2 text." }`; a bundle of two image messages (use two small placeholder PNGs committed beside the fixture) and two texts: `"I like the writing on page 1 more than page 2"` and `"Set above the valley, Alder House takes a quieter approach to family living."`; and an `expected` block: `kind: "request"`, the Alder House project id, `replacesRequestId: "r-2022"`, a non-null question, and a task chain whose kinds are `["ask","do","tell"]`.

- [ ] **Step 1: Write the failing tests**

```ts
const ctx: InterpretContext = {
  person: { id: "p1", name: "Maren" },
  today: "2026-11-14",
  projects: [{ id: "pr1", name: "Alder House", hints: "" }],
  recentRequests: [
    { id: "r-2022", projectId: "pr1", understood: "Maren asked for the Alder House page 2 text." },
  ],
  waitingAsks: [{ id: "t-ask", title: "Words or type?" }],
  fixNote: null,
};

it("keeps a well-formed request with its chain", () => {
  const out = parseInterpretation(
    {
      kind: "request",
      understood: "Maren asked to replace the page 2 text.",
      projectId: "pr1",
      question: { text: "Words or type?", options: ["Only words", "Type too", "Ask Maren"] },
      replacesRequestId: "r-2022",
      tasks: [
        {
          kind: "ask",
          title: "Words or type?",
          withPerson: true,
          after: null,
          answersQuestion: true,
          kit: {},
        },
        {
          kind: "do",
          title: "Replace page 2 copy",
          withPerson: false,
          after: 0,
          answersQuestion: false,
          kit: {},
        },
        {
          kind: "tell",
          title: "Tell Maren it's live",
          withPerson: true,
          after: 1,
          answersQuestion: false,
          kit: {},
        },
      ],
    },
    ctx,
  );
  expect(out.tasks.map((t) => t.kind)).toEqual(["ask", "do", "tell"]);
  expect(out.tasks[2].after).toBe(1);
  expect(out.replacesRequestId).toBe("r-2022");
});
// Review Focus 3
it("drops ids that are not in the context", () => {
  const out = parseInterpretation(
    {
      kind: "request",
      understood: "x",
      projectId: "someone-elses",
      replacesRequestId: "nope",
      repliesToTaskId: "nope",
      tasks: [],
    },
    ctx,
  );
  expect(out.projectId).toBeNull();
  expect(out.replacesRequestId).toBeNull();
  expect(out.repliesToTaskId).toBeNull();
});
it("caps question options at three and drops empties", () => {
  const out = parseInterpretation(
    {
      kind: "request",
      understood: "x",
      question: { text: "Which?", options: ["A", " ", "B", "C", "D"] },
      tasks: [],
    },
    ctx,
  );
  expect(out.question?.options).toEqual(["A", "B", "C"]);
});
it("nulls an after that points forward or at itself", () => {
  const out = parseInterpretation(
    {
      kind: "request",
      understood: "x",
      tasks: [
        { kind: "do", title: "a", after: 1 },
        { kind: "tell", title: "b", after: 1 },
      ],
    },
    ctx,
  );
  expect(out.tasks.map((t) => t.after)).toEqual([null, null]);
});
it("drops a due date in the past", () => {
  expect(
    parseInterpretation({ kind: "request", understood: "x", dueDate: "2026-11-01", tasks: [] }, ctx)
      .dueDate,
  ).toBeNull();
});
it("strips tasks and question from ordinary chat", () => {
  const out = parseInterpretation(
    {
      kind: "chat",
      understood: "",
      question: { text: "q", options: ["a"] },
      tasks: [{ kind: "do", title: "a" }],
    },
    ctx,
  );
  expect(out.tasks).toEqual([]);
  expect(out.question).toBeNull();
});
it("turns unusable input into chat without throwing", () => {
  expect(parseInterpretation("not an object", ctx).kind).toBe("chat");
  expect(parseInterpretation(null, ctx).kind).toBe("chat");
});
// Review Focus 2
it("builds a message for a bundle that has images and no text", () => {
  const msgs = buildInterpretMessages(
    [
      {
        id: "m1",
        personId: "p1",
        channel: "imessage",
        direction: "in",
        text: "",
        attachments: [{ storagePath: "coach/u/a.png", mediaType: "image/png" }],
        sentAt: "2026-11-14T09:42:00Z",
      },
    ],
    [{ bytes: Buffer.from("x"), mediaType: "image/png" }],
    ctx,
  );
  const blocks = msgs.at(-1)!.content as Anthropic.ContentBlockParam[];
  expect(blocks.some((b) => b.type === "image")).toBe(true);
  expect(JSON.stringify(blocks)).toContain("(no text was sent with these)");
});
it("calls the model once with the forced tool and returns the parsed result", async () => {
  createMock.mockResolvedValue({
    content: [
      { type: "tool_use", name: "record_interpretation", input: { kind: "chat", understood: "" } },
    ],
  });
  const out = await interpretBundle([textMessage("thanks!")], [], ctx);
  expect(out.kind).toBe("chat");
  expect(createMock.mock.calls[0][0]).toMatchObject({
    model: "claude-opus-5-5",
    tool_choice: { type: "auto" },
  });
});
```

Mock the Anthropic SDK the way `apps/server/src/services/__tests__/chat.test.ts` does.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `parseInterpretation`, `buildInterpretMessages`, the prompt and tool schema, `interpretBundle`; add the fixture and its two placeholder images.**
- [ ] **Step 4: Run the tests and typecheck** → PASS.
- [ ] **Step 5: Run the fixture against the real model once** — add `apps/server/scripts/coach-interpret-fixture.ts` that loads the fixture, calls `interpretBundle`, prints the result and exits non-zero unless it matches `expected` (kind, project id, `replacesRequestId`, question non-null, chain kinds). Run `pnpm -C apps/server tsx --env-file=.env.local scripts/coach-interpret-fixture.ts`. Expected: `fixture ok`. If no API key is available, report that this step was not run.
- [ ] **Step 6: Commit** — `add coach bundle interpretation`

---

### Task 6: Process a bundle

**Files:**

- Create: `apps/server/src/functions/processBundle.ts`, `apps/server/src/services/imageClip.ts`
- Modify: `apps/server/src/routes/clips.ts` (the `if (body.imagePath)` branch calls `createImageClip`), `apps/server/src/app.ts` (add `processBundle` to the `functions` array)
- Test: `apps/server/src/functions/__tests__/processBundle.test.ts`, `apps/server/src/services/__tests__/imageClip.test.ts`

**Interfaces:**

- Consumes: `interpretBundle`, `InterpretContext`, `downloadImage` (`lib/storage.js`), mappers.
- Produces:
  - `export async function createImageClip(userId: string, storagePath: string, extraTags: string[]): Promise<Record<string, unknown>>` — the insert-with-vision-and-tags logic currently inline in `routes/clips.ts`, moved unchanged, with `extraTags` merged into the clip's tags. Returns the inserted row. `routes/clips.ts` keeps its response shape.
  - `export const processBundle` — Inngest function `{ id: "coach-process-bundle", retries: 2, debounce: { key: "event.data.bundleId", period: "3m" }, triggers: [{ event: "coach/bundle.touched" }], onFailure }`.
  - `export async function storeInterpretation(bundle, messages, interp, userId): Promise<{ requestId: string | null }>` — the write step, exported for testing.

Steps inside the function: (1) load the bundle; if its status is `done`, return. Set status `processing`. (2) Load its messages, the person, the user's active projects with their `tag_hints.hints`, the person's 20 most recent requests with status `new` or `confirmed`, and `ask` tasks in state `waiting` with this person. (3) Download each attachment with `downloadImage`; convert nothing here (HEIC handling is the helper's job in plan 5; an image that fails to download is skipped and logged). (4) `interpretBundle`. (5) `storeInterpretation`. (6) Set status `done` and `kind`.

`storeInterpretation` by kind:

- `chat`: writes nothing.
- `reply`: sets `reply_bundle_id` on the task named by `repliesToTaskId` (if any). Creates clips for the bundle's attachments.
- `request`: if `newProjectName` is set and `projectId` is null, creates the project (tag from `projectTag`) and links the person. Inserts one `coach_requests` row with `proposed_tasks`, `open_question`, `proposed_replaces_id`, `due_date`; `status` is `new`, or `closed` with `historical: true` and empty `proposed_tasks` when the bundle is historical. Insert uses `upsert` on `bundle_id` so a retry does not create a second request. Creates clips for the attachments, tagged with the project's tag, and writes each `clipId` back into the message's `attachments`.

`onFailure` sets the bundle's status to `failed`. A `failed` bundle is picked up again because intake's `pickBundle` treats it as not collecting (new bundle for new messages), and because step (1) only skips `done`: re-sending `coach/bundle.touched` for a failed bundle reprocesses it.

- [ ] **Step 1: Write the failing tests**

```ts
it("stores a request with its proposed chain for a request bundle", async () => {
  const out = await storeInterpretation(bundle(), messages(), requestInterp(), "u1");
  expect(out.requestId).toBe("r1");
  expect(inserted("coach_requests")).toMatchObject({
    status: "new",
    proposed_replaces_id: "r-2022",
    project_id: "pr1",
    bundle_id: "b1",
  });
  expect(inserted("coach_requests").proposed_tasks).toHaveLength(3);
});
it("stores a historical request as closed with no proposed tasks", async () => {
  await storeInterpretation(bundle({ historical: true }), messages(), requestInterp(), "u1");
  expect(inserted("coach_requests")).toMatchObject({
    status: "closed",
    historical: true,
    proposed_tasks: [],
  });
});
it("writes nothing for ordinary chat", async () => {
  const out = await storeInterpretation(bundle(), messages(), chatInterp(), "u1");
  expect(out.requestId).toBeNull();
  expect(insertedTables()).toEqual([]);
  expect(createImageClipMock).not.toHaveBeenCalled();
});
it("links a reply to the waiting ask and does not create a request", async () => {
  await storeInterpretation(bundle(), messages(), replyInterp("t-ask"), "u1");
  expect(updated("coach_tasks")).toMatchObject({ reply_bundle_id: "b1" });
  expect(insertedTables()).not.toContain("coach_requests");
});
it("creates a clip per attachment tagged with the project", async () => {
  await storeInterpretation(bundle(), messagesWithTwoImages(), requestInterp(), "u1");
  expect(createImageClipMock).toHaveBeenCalledTimes(2);
  expect(createImageClipMock).toHaveBeenCalledWith("u1", expect.stringMatching(/^coach\/u1\//), [
    "project:alder-house",
  ]);
});
it("creates the project when the model names a new one", async () => {
  await storeInterpretation(
    bundle(),
    messages(),
    requestInterp({ projectId: null, newProjectName: "Studio prints" }),
    "u1",
  );
  expect(inserted("coach_projects")).toMatchObject({
    name: "Studio prints",
    tag: "project:studio-prints",
  });
});
// Review Focus 5
it("marks the bundle failed when interpretation throws, leaving messages untouched", async () => {
  interpretMock.mockRejectedValue(new Error("timeout"));
  await runOnFailure({ bundleId: "b1", userId: "u1" });
  expect(updated("coach_bundles")).toMatchObject({ status: "failed" });
  expect(deletedTables()).toEqual([]);
});
it("skips a bundle that is already done", async () => {
  await runProcess({ bundleId: "b-done", userId: "u1" });
  expect(interpretMock).not.toHaveBeenCalled();
});
// imageClip.test.ts
it("merges extra tags into the created clip", async () => {
  const row = await createImageClip("u1", "coach/u1/a.png", ["project:alder-house"]);
  expect(row.tags).toContain("project:alder-house");
});
```

Follow `apps/server/src/functions/__tests__/visionClip.test.ts` for invoking an Inngest handler with a fake `step`.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Extract `createImageClip` and switch `routes/clips.ts` to it. Run `pnpm vitest run apps/server/src/routes/__tests__/clips-image.test.ts apps/server/src/routes/__tests__/clips.test.ts`** → still PASS.
- [ ] **Step 4: Implement `storeInterpretation` and `processBundle`; register it in `app.ts`.**
- [ ] **Step 5: Run the new tests, typecheck, lint** → PASS.
- [ ] **Step 6: Commit** — `process coach bundles into requests`

---

### Task 7: Requests API and the task chain

**Files:**

- Create: `apps/server/src/services/coach/chain.ts`, `apps/server/src/services/coach/history.ts`, `apps/server/src/routes/coach/requests.ts`
- Modify: `apps/server/src/routes/coach/index.ts` (mount `/requests`), `apps/server/src/routes/coach/projects.ts` (add `GET /:id/history`)
- Test: `apps/server/src/services/coach/__tests__/chain.test.ts`, `.../history.test.ts`, `apps/server/src/routes/coach/__tests__/requests.test.ts`

**Interfaces — Produces:**

```ts
// chain.ts
export interface TaskInsert {
  kind: TaskKind;
  title: string;
  kit: TaskKit;
  withPerson: boolean;
  afterIndex: number | null;
  position: number;
}
/** Drops the task that answers the open question when it was answered, re-pointing dependents. */
export function materializeChain(
  proposed: ProposedTask[],
  opts: { answered: boolean },
): TaskInsert[];
export function isBlocked(
  task: { afterTaskId: string | null },
  byId: Map<string, { state: TaskState }>,
): boolean; // predecessor exists and is open or waiting
export function stateAfterSent(kind: TaskKind): TaskState | null; // ask→"waiting", tell→"done", else null

// history.ts
export interface HistoryEntry {
  request: CoachRequest;
  replaced: CoachRequest[];
}
/** Newest first. A replaced request appears only under the request that replaced it, oldest last. */
export function buildHistory(requests: CoachRequest[]): HistoryEntry[];
```

Routes:

- `GET /coach/requests?status=` → `{ requests: CoachRequest[] }`, newest first, `status` optional.
- `GET /coach/requests/:id` → `{ request, messages: InboundMessage[], replaces: CoachRequest | null }`; each attachment gets a signed `url` via `signImageUrl`. Uses `proposedReplacesId` for `replaces` while the request is `new`, `replacesId` after.
- `POST /coach/requests/:id/confirm` `{ answer?, projectId?, replaces? }` → `{ request, tasks: CoachTask[] }`. Only from status `new`; any other status returns `200` with the current request and its existing tasks and writes nothing. On confirm: set `status: "confirmed"`, `confirmed_at`, `answer`, `project_id` (body value wins); when `replaces !== false` and `proposed_replaces_id` is set, set `replaces_id` and mark that request `replaced`; insert tasks from `materializeChain(proposed, { answered: !!answer })` with `after_task_id` resolved from `afterIndex`, `with_person_id` = the request's person when `withPerson`, `project_id`, `request_id`, and `due_date` = the request's `due_date` on the first `do` task. The status change uses `.eq("status", "new")` and proceeds only if a row was updated, so two concurrent confirms create one chain.
- `POST /coach/requests/:id/fix` `{ note }` → `202 { ok: true }`. Requires status `new` (409 otherwise) and a non-empty note. Deletes the request row, sets the bundle's `fix_note` and status `collecting`, and sends `coach/bundle.touched`. (`processBundle` passes `fix_note` as `ctx.fixNote`.)
- `GET /coach/projects/:id/history` → `{ entries: HistoryEntry[] }` from `buildHistory` over that project's non-`new` requests.

- [ ] **Step 1: Write the failing tests**

```ts
const proposed: ProposedTask[] = [
  {
    kind: "ask",
    title: "Words or type?",
    withPerson: true,
    after: null,
    answersQuestion: true,
    kit: {},
  },
  {
    kind: "do",
    title: "Replace page 2 copy",
    withPerson: false,
    after: 0,
    answersQuestion: false,
    kit: {},
  },
  {
    kind: "tell",
    title: "Tell Maren it's live",
    withPerson: true,
    after: 1,
    answersQuestion: false,
    kit: {},
  },
];
it("keeps the whole chain when the question is unanswered", () => {
  expect(
    materializeChain(proposed, { answered: false }).map((t) => [t.kind, t.afterIndex]),
  ).toEqual([
    ["ask", null],
    ["do", 0],
    ["tell", 1],
  ]);
});
it("drops the ask and re-points the chain when the question was answered", () => {
  expect(materializeChain(proposed, { answered: true }).map((t) => [t.kind, t.afterIndex])).toEqual(
    [
      ["do", null],
      ["tell", 0],
    ],
  );
});
it("is blocked while the predecessor is open or waiting, not when done or dropped", () => {
  const byId = new Map([
    ["a", { state: "waiting" as const }],
    ["b", { state: "done" as const }],
  ]);
  expect(isBlocked({ afterTaskId: "a" }, byId)).toBe(true);
  expect(isBlocked({ afterTaskId: "b" }, byId)).toBe(false);
  expect(isBlocked({ afterTaskId: null }, byId)).toBe(false);
});
it("sent moves an ask to waiting and a tell to done, and nothing else", () => {
  expect(stateAfterSent("ask")).toBe("waiting");
  expect(stateAfterSent("tell")).toBe("done");
  expect(stateAfterSent("do")).toBeNull();
  expect(stateAfterSent("get")).toBeNull();
});
// history.test.ts
it("nests a replaced request under the one that replaced it, newest first", () => {
  const entries = buildHistory([
    req({ id: "r1", status: "replaced", createdAt: "2022-03-01T00:00:00Z" }),
    req({ id: "r2", status: "confirmed", replacesId: "r1", createdAt: "2026-11-14T00:00:00Z" }),
    req({ id: "r3", status: "closed", createdAt: "2026-10-28T00:00:00Z" }),
  ]);
  expect(entries.map((e) => e.request.id)).toEqual(["r2", "r3"]);
  expect(entries[0].replaced.map((r) => r.id)).toEqual(["r1"]);
});
it("follows a chain of replacements under the newest", () => {
  const entries = buildHistory([
    req({ id: "a", status: "replaced" }),
    req({ id: "b", status: "replaced", replacesId: "a" }),
    req({ id: "c", status: "confirmed", replacesId: "b" }),
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0].replaced.map((r) => r.id)).toEqual(["b", "a"]);
});
// requests.test.ts
it("confirming with an answer creates do and tell, and marks the old request replaced", async () => {
  const res = await post("/api/coach/requests/r1/confirm", { answer: "Only the words" });
  const body = await res.json();
  expect(body.request.status).toBe("confirmed");
  expect(body.tasks.map((t: CoachTask) => t.kind)).toEqual(["do", "tell"]);
  expect(updatedRow("coach_requests", "r-2022")).toMatchObject({ status: "replaced" });
});
it("does not replace when replaces is false", async () => {
  await post("/api/coach/requests/r1/confirm", { replaces: false });
  expect(updatedRow("coach_requests", "r-2022")).toBeUndefined();
});
// Review Focus 4
it("a second confirm creates no more tasks", async () => {
  mockRequestStatus("confirmed");
  const res = await post("/api/coach/requests/r1/confirm", {});
  expect(res.status).toBe(200);
  expect(insertedTables()).not.toContain("coach_tasks");
});
it("fix requires a note and a new request", async () => {
  expect((await post("/api/coach/requests/r1/fix", { note: " " })).status).toBe(400);
  mockRequestStatus("confirmed");
  expect((await post("/api/coach/requests/r1/fix", { note: "It's the homepage" })).status).toBe(
    409,
  );
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `chain.ts` and `history.ts`.**
- [ ] **Step 4: Implement the request routes and the history route.**
- [ ] **Step 5: Run the tests, typecheck, lint** → PASS.
- [ ] **Step 6: Commit** — `add coach requests, confirm and project history`

---

### Task 8: Tasks API

**Files:**

- Create: `apps/server/src/routes/coach/tasks.ts`
- Modify: `apps/server/src/routes/coach/index.ts` (mount `/tasks`)
- Test: `apps/server/src/routes/coach/__tests__/tasks.test.ts`

**Interfaces:**

- Consumes: `isBlocked`, `stateAfterSent`, `toTask`.
- Produces:
  - `GET /coach/tasks?state=&projectId=` → `{ tasks: CoachTask[] }`, each with `blocked` computed over all the user's tasks; default excludes `done` and `dropped`; ordered by `due_date` nulls last, then `position`.
  - `POST /coach/tasks` `{ kind, title, projectId?, withPersonId?, dueDate?, dueTime?, place?, checklist?, kit? }` → `201 { task }`. For tasks Suzi makes herself, with no request.
  - `PATCH /coach/tasks/:id` `{ title?, state?, dueDate?, dueTime?, place?, checklist?, kit? }` → `{ task }`. Setting `state: "done"` sets `done_at`; leaving `done` clears it.
  - `POST /coach/tasks/:id/sent` → `{ task }`; applies `stateAfterSent`; 400 `only tell and ask tasks can be sent` for other kinds.

Validation: `kind` must be a `TaskKind`; `title` non-empty; `dueDate` matches `YYYY-MM-DD`; `dueTime` matches `HH:MM` and requires `dueDate` (400 `dueTime needs a dueDate`); `place` and `checklist` are accepted only when `kind` is `get` (400 `place and checklist are for get tasks`); `state: "done"` on a blocked task returns 409 `task is blocked`; `state: "waiting"` cannot be set through PATCH (400), only through `/sent`.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists open tasks with blocked computed from the predecessor", async () => {
  mockTasks([
    taskRow({ id: "a", kind: "ask", state: "waiting" }),
    taskRow({ id: "b", kind: "do", state: "open", after_task_id: "a" }),
  ]);
  const { tasks } = await (await get("/api/coach/tasks")).json();
  expect(tasks.find((t: CoachTask) => t.id === "b").blocked).toBe(true);
  expect(tasks.find((t: CoachTask) => t.id === "a").blocked).toBe(false);
});
it("creates an errand with a place and checklist", async () => {
  const res = await post("/api/coach/tasks", {
    kind: "get",
    title: "Framing supplies",
    place: "Art store",
    checklist: [
      { text: "Mat board", done: false },
      { text: "Hanging wire", done: false },
    ],
  });
  expect(res.status).toBe(201);
});
it("rejects a place on a task that is not an errand", async () => {
  expect(
    (await post("/api/coach/tasks", { kind: "do", title: "x", place: "Art store" })).status,
  ).toBe(400);
});
it("rejects a time without a date", async () => {
  expect(
    (await post("/api/coach/tasks", { kind: "do", title: "x", dueTime: "09:00" })).status,
  ).toBe(400);
});
it("sent moves an ask to waiting", async () => {
  mockTask(taskRow({ id: "a", kind: "ask", state: "open" }));
  await post("/api/coach/tasks/a/sent", {});
  expect(updated("coach_tasks")).toMatchObject({ state: "waiting" });
});
it("sent refuses a do task", async () => {
  mockTask(taskRow({ id: "d", kind: "do", state: "open" }));
  expect((await post("/api/coach/tasks/d/sent", {})).status).toBe(400);
});
it("refuses to complete a blocked task", async () => {
  mockTasks([
    taskRow({ id: "a", kind: "ask", state: "waiting" }),
    taskRow({ id: "b", kind: "do", state: "open", after_task_id: "a" }),
  ]);
  expect((await patch("/api/coach/tasks/b", { state: "done" })).status).toBe(409);
});
it("stamps done_at when a task is completed and clears it when reopened", async () => {
  mockTask(taskRow({ id: "d", kind: "do", state: "open" }));
  await patch("/api/coach/tasks/d", { state: "done" });
  expect(updated("coach_tasks").done_at).toEqual(expect.any(String));
  mockTask(taskRow({ id: "d", kind: "do", state: "done" }));
  await patch("/api/coach/tasks/d", { state: "open" });
  expect(updated("coach_tasks").done_at).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement the routes and mount them.**
- [ ] **Step 4: Run the whole server suite, typecheck and lint** — `pnpm vitest run apps/server`, `pnpm -C apps/server typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: Commit** — `add coach tasks endpoints`

---

### Task 9: End-to-end proof and docs

**Files:**

- Create: `apps/server/scripts/coach-e2e.ts`, `docs/decisions/<next-number>-coach-server-core.md`
- Modify: `docs/architecture.md` (a short "Coach" section: tables, routes, the bundle → request → tasks flow)

**Interfaces — Consumes:** every route above, against a locally running server.

`coach-e2e.ts` takes a base URL and an API key from the environment (`COACH_E2E_URL`, `COACH_E2E_KEY`) and, for an account with the switch on: creates person Maren (`both`), seeds or creates project Alder House, inserts the 2022 request directly through `POST /coach/intake/messages` with `historical: true` and waits for it, uploads the fixture's two images through `/coach/intake/upload-url`, posts the fixture bundle, polls `GET /coach/requests?status=new` until the request appears (timeout 6 minutes, since the debounce is 3), prints it, confirms it with `answer: "Only the words"`, then prints `GET /coach/tasks` and `GET /coach/projects/:id/history`. It exits non-zero unless: one new request exists for Alder House; its `proposedReplacesId` is the 2022 request; after confirm the tasks are `do` (open, not blocked) and `tell` (blocked); history's first entry has the 2022 request under `replaced`.

- [ ] **Step 1: Write `coach-e2e.ts`.**
- [ ] **Step 2: Run it** — start the server and Inngest dev (`pnpm dev:server`), set `coach_enabled = true` for the test account with `psql`, create an API key for it, then `pnpm -C apps/server tsx scripts/coach-e2e.ts`. Expected final line: `coach e2e ok`. Paste the printed request, tasks and history into the task report. If the environment has no database or API key, report exactly which step could not run; do not mark the task done.
- [ ] **Step 3: Write the ADR** (read `docs/.lore/types/decision.schema.yaml` first): bundles debounced in Inngest; interpretation as a forced tool call validated by a pure parser; task chain stored as proposed JSON until confirm; projects tied to `project:` tags. Add the Coach section to `docs/architecture.md`.
- [ ] **Step 4: Commit** — `add coach end-to-end script and docs`
