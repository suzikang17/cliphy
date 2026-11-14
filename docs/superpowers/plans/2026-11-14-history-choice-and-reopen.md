# History choice and reopening history requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner read a thread's past when adding someone from the Mac app, and turn any request filed as history back into a live request to confirm.

**Architecture:** The helper and server already understand a per-person history setting (`historyWindow`, `historyDays`); the Mac app only has to send it. Reopening reuses the "Fix it" path: clear the bundle's history flag, reset it, and send the existing `coach/bundle.retry` event, so the bundle job reads it again as a live bundle and upserts the same request row (unique on `bundle_id`) and announces it once.

**Tech Stack:** TypeScript strict, Hono, Supabase, Inngest, Vitest; Electron (Mac app); Expo / React Native (phone).

**Spec:** `docs/superpowers/specs/2026-11-14-history-choice-and-reopen-design.md`

## Global Constraints

- Public repo: no real client names, numbers or message text anywhere. Fixtures use the client "Maren" and the project "Alder House".
- No database migration. If one turns out to be needed, stop and ask; never apply to production.
- History choices, exactly: "New messages only" (default) → `historyWindow: "new"`; "Last 30 days" → `historyWindow: "window", historyDays: 30`; "Everything" → `historyWindow: "all"`.
- Button label on the phone, exactly: "Still needs doing".
- Reading history stays silent; only an explicit reopen posts in Chat.
- Reopen never creates a second request row and never deletes messages.
- Checks before each commit: `pnpm exec vitest run <touched area>`, the package's `typecheck`, `pnpm lint`.
- Commits: imperative mood, to main, ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Double tap on "Still needs doing"** (or a retried call): one re-read, one Chat message. Pinned in Task 2.
2. **Reopen called on a request that is not history** (new, confirmed, replaced): refused with 409, nothing changed, no event. Pinned in Task 2.
3. **The re-read cannot be started** (Inngest send throws): the bundle must go back to history so the button still works. Pinned in Task 2.
4. **Add pressed with an empty name while a history choice is selected:** nothing is sent. Pinned in Task 1.
5. **The re-read decides the old messages are a reply or chat, not a request:** the phone must stop waiting and say so instead of spinning. Pinned in Task 3.

---

### Task 1: History choice when adding from Messages (Mac app)

**Files:**

- Modify: `apps/mac-app/src/controller.ts` (`ControllerDeps.addPerson`, `Controller.addPerson`)
- Modify: `apps/mac-app/src/main.ts` (`addPerson`, the `add-person` IPC handler)
- Modify: `apps/mac-app/src/preload.ts` (`addPerson`)
- Modify: `apps/mac-app/ui/app.js` (the Add form in `threadRow`), `apps/mac-app/ui/style.css`
- Test: `apps/mac-app/src/__tests__/controller.test.ts`

**Interfaces:**

- Produces: `type AddHistory = "new" | "30days" | "all"` exported from `controller.ts`; `Controller.addPerson(handle: string, rawName: string, history?: AddHistory): Promise<void>`; `ControllerDeps.addPerson(config, input: { name: string; handle: string; historyWindow: HistoryWindow; historyDays: number | null })`.

- [ ] **Step 1: Write the failing tests** in the "adding someone from Messages" block:

```ts
it("sends how far back to read with the new person", async () => {
  const added: unknown[] = [];
  const { c } = setup({ addPerson: async (_c, i) => void added.push(i) }, paired);
  await c.addPerson("sam@example.com", "Sam");
  await c.addPerson("sam@example.com", "Sam", "30days");
  await c.addPerson("sam@example.com", "Sam", "all");
  expect(added).toEqual([
    { name: "Sam", handle: "sam@example.com", historyWindow: "new", historyDays: null },
    { name: "Sam", handle: "sam@example.com", historyWindow: "window", historyDays: 30 },
    { name: "Sam", handle: "sam@example.com", historyWindow: "all", historyDays: null },
  ]);
});

it("sends nothing when the name is empty, whatever the history choice", async () => {
  const added: unknown[] = [];
  const { c } = setup({ addPerson: async (_c, i) => void added.push(i) }, paired);
  await c.addPerson("sam@example.com", "  ", "all");
  expect(added).toEqual([]);
});
```

Update the existing "adds the person with capture on" expectation to include `historyWindow: "new", historyDays: null`.

- [ ] **Step 2: Run** `pnpm exec vitest run apps/mac-app` — expected: the two new tests fail.
- [ ] **Step 3: Implement.** Controller maps `AddHistory` to the two fields (an unknown value is treated as `"new"`). `main.ts` sends `historyWindow` and, only for `"window"`, `historyDays` in the POST body (replacing the fixed `historyWindow: "new"`); the IPC handler passes a third argument through. `preload.ts`: `addPerson(handle, name, history)`.
- [ ] **Step 4: UI.** In the Add form, under the name box, a `<select>` with the three labels from Global Constraints, default "New messages only", `aria-label` "How far back to read". Keep the selection in the `adding` object (`adding.history`) so a redraw does not reset it. Submit passes it.
- [ ] **Step 5: Run** `pnpm exec vitest run apps/mac-app && pnpm --filter cliphy-helper-app typecheck && pnpm lint` — expected: all pass.
- [ ] **Step 6: See it.** `CLIPHY_SMOKE_OUT=<dir>` draws fixed screens only, so check by hand: `pnpm --filter cliphy-helper-app start --remote-debugging-port=9333`, press Add on a thread, and capture the window showing the choice (README "Working on it" explains the launch).
- [ ] **Step 7: Commit** — `let the Mac app choose how far back to read when adding someone`.

### Task 2: Reopen a history request (server)

**Files:**

- Modify: `apps/server/src/services/coach/requestActions.ts` (new `reopenRequest`)
- Modify: `apps/server/src/routes/coach/requests.ts` (new route)
- Test: `apps/server/src/routes/coach/__tests__/requests.test.ts`

**Interfaces:**

- Produces: `POST /api/coach/requests/:id/reopen` → `202 { ok: true }` | `404 { error: "request not found" }` | `409 { error: "request is not history" }` | `500 { error: "Could not start the re-read" }`.
- Produces: `reopenRequest(userId: string, id: string): Promise<ReopenResult>` with `ReopenResult = { status: 202; body: { ok: true } } | { status: 404 | 409 | 500; body: { error: string } }`.

- [ ] **Step 1: Write the failing tests**, following the existing `fix` tests in the same file (same fake db and `inngestSend` mock). Seed request `r1` with `historical: true, status: "closed"` and its bundle `b1` with `historical: true, status: "done"`:

```ts
it("reopen sends a history request to be read again as a live one", async () => {
  const res = await post("/api/coach/requests/r1/reopen", {});
  expect(res.status).toBe(202);
  // bundle b1 updated with: { historical: false, status: "collecting", kind: null }
  expect(inngestSend).toHaveBeenCalledWith({
    name: "coach/bundle.retry",
    data: { bundleId: "b1", userId: "u1" },
  });
  // the request row is neither deleted nor inserted
});

it("reopen refuses a request that is not history", async () => {
  // for each of: { historical: false, status: "new" }, { historical: false, status: "confirmed" },
  // { historical: true, status: "replaced" }
  expect(res.status).toBe(409);
  expect(inngestSend).not.toHaveBeenCalled();
});

it("reopen is answered once: a second call while the re-read is under way sends nothing", async () => {
  // request still historical+closed, but bundle b1 already has historical: false
  expect(res.status).toBe(202);
  expect(inngestSend).not.toHaveBeenCalled();
});

it("reopen puts the bundle back when the re-read cannot be started", async () => {
  inngestSend.mockRejectedValueOnce(new Error("down"));
  expect(res.status).toBe(500);
  // last update to bundle b1: { historical: true, status: "done" }
});

it("reopen of an unknown request is 404", async () => {
  /* 404 */
});
```

Use the user id and assertion helpers the neighbouring tests use; the comments above name what to assert, in that file's existing style.

- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/src/routes/coach/__tests__/requests.test.ts` — expected: the new tests fail with 404.
- [ ] **Step 3: Implement `reopenRequest`** next to `fixRequest`, same shape: load the request (404); require `historical === true && status === "closed"` (else 409); load its bundle scoped to the user; if the bundle's `historical` is not `true`, return 202 without sending; update the bundle to `{ historical: false, status: "collecting", kind: null }`; send `coach/bundle.retry`; on a throw restore `{ historical: true, status: "done" }` and return 500. The request row is not touched: the bundle job's upsert on `bundle_id` rewrites it as `new` and posts `requestArrived`, which is keyed on the request id.
- [ ] **Step 4: Add the route** in `requests.ts` after `/:id/fix`. Phone only: return 403 `{ error: "Sign in on the phone to do this" }` when `c.get("authMethod") === "api_key"`, and add a test for it if the test helpers can set the auth method (if `passAuth` cannot, say so in the commit body and leave the check in).
- [ ] **Step 5: Check the job side by reading, not changing it:** in `apps/server/src/functions/processBundle.ts` confirm that a bundle with `historical: false` and `status: "collecting"` is claimed, interpreted with images, stored as `status: "new"` with `historical: false`, and announced. If any of those is not true, stop and report rather than patch around it.
- [ ] **Step 6: Run** `pnpm exec vitest run apps/server/src/routes/coach apps/server/src/functions && pnpm --filter server typecheck && pnpm lint` (use the server package's real name from its `package.json`) — expected: all pass.
- [ ] **Step 7: Commit** — `reopen a history request so it can be confirmed like a new one`.

### Task 3: "Still needs doing" on the phone

**Files:**

- Modify: `apps/mobile/lib/coachApi.ts` (new `reopenRequest`)
- Modify: `apps/mobile/app/coach/request/[id].tsx`
- Test: `apps/mobile/lib/__tests__/coach.test.ts` (only if a pure helper is extracted, see Step 1)

**Interfaces:**

- Consumes: `POST /api/coach/requests/:id/reopen` from Task 2.
- Produces: `reopenRequest(id: string): Promise<{ ok: true }>` in `coachApi.ts`; `reopenOutcome(before: CoachRequest, now: CoachRequest | null, waitedMs: number): "waiting" | "reopened" | "not-a-request"` in `apps/mobile/lib/coach.ts`.

- [ ] **Step 1: Write the failing test** for `reopenOutcome` in `coach.test.ts`:

```ts
it("knows when a reopened request has come back", () => {
  const history = { ...request, historical: true, status: "closed" as const };
  expect(reopenOutcome(history, history, 3_000)).toBe("waiting");
  expect(reopenOutcome(history, { ...history, historical: false, status: "new" }, 6_000)).toBe(
    "reopened",
  );
  // Read again and judged not to be a request: the row stays history.
  expect(reopenOutcome(history, history, 60_000)).toBe("not-a-request");
});
```

Build `request` from whatever fixture that test file already has; 60 000 ms is the limit.

- [ ] **Step 2: Run** `pnpm exec vitest run apps/mobile/lib` — expected: fails, `reopenOutcome` not defined.
- [ ] **Step 3: Implement** `reopenOutcome` and `reopenRequest`.
- [ ] **Step 4: Screen.** On the request page, when `request.historical && request.status === "closed"`, show one button, "Still needs doing", where "Looks right / Fix it" sit for a new request. On press: call `reopenRequest`, show "Reading it again…", refetch the request every 3 s and feed `reopenOutcome`. `reopened` → the page redraws as a new request with its normal buttons. `not-a-request` → one line: "Read again, and there was nothing to do in it." A failed call shows the page's existing error treatment and re-enables the button.
- [ ] **Step 5: Run** `pnpm exec vitest run apps/mobile/lib && pnpm --filter mobile typecheck && pnpm lint` (use the phone package's real name) — expected: all pass.
- [ ] **Step 6: Commit** — `add "Still needs doing" to history requests on the phone`.

### Task 4: Prove it, write it down

- [ ] **Step 1: Server deploy check.** After the push, confirm the deployed API answers the new route: an unauthenticated `POST https://api.cliphy.app/api/coach/requests/x/reopen` returns 401, not 404.
- [ ] **Step 2: Real run, with the owner.** In the Mac app, add a thread with "Last 30 days"; within a few cycles `~/.cliphy-helper/helper.log` shows an upload line. On the phone (after the app update), open one of the history requests in that project, press "Still needs doing", and see it arrive in Chat as a request to confirm. This step needs the owner and an app update; report it as pending if either is missing.
- [ ] **Step 3: Docs.** Devlog entry for the day (via `/devlog`), `apps/mac-app/README.md` "Using it" gains one line about the history choice, then `lore reindex devlog && lore validate devlog`.
- [ ] **Step 4: Commit and push.**
