# Background Service Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the extension background worker to queue videos and generate summaries via the API, with context menu support.

**Architecture:** Synchronous MVP — background worker calls `POST /api/queue` to create a pending row, then `POST /api/queue/:id/process` to generate the summary server-side. Context menu adds "Add to Cliphy" on YouTube pages. `extractVideoId` moves to `@cliphy/shared` for reuse.

**Tech Stack:** WXT (Chrome MV3), Hono, Supabase, `@cliphy/shared`

---

### Task 1: Move `extractVideoId` to `@cliphy/shared`

**Files:**

- Create: `packages/shared/src/utils.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/routes/queue.ts:1-6,18-44`
- Modify: `apps/server/src/routes/__tests__/queue.test.ts:4`

**Step 1: Create `packages/shared/src/utils.ts`**

Copy `extractVideoId` from `apps/server/src/routes/queue.ts:18-44` into a new file:

```typescript
/**
 * Extract YouTube video ID from various URL formats.
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace("www.", "");

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const vParam = parsed.searchParams.get("v");
      if (vParam) return vParam;

      const pathMatch = parsed.pathname.match(/^\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[2];

      return null;
    }

    if (hostname === "youtu.be") {
      const id = parsed.pathname.slice(1);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}
```

**Step 2: Export from `packages/shared/src/index.ts`**

Add `export * from "./utils.js";` to the barrel export.

**Step 3: Update server import**

In `apps/server/src/routes/queue.ts`, remove the `extractVideoId` function definition (lines 8-44) and add import:

```typescript
import { extractVideoId } from "@cliphy/shared";
```

Also remove the `export` from the function since it's no longer defined here.

**Step 4: Update test import**

In `apps/server/src/routes/__tests__/queue.test.ts:4`, change:

```typescript
import { extractVideoId } from "../queue.js";
```

to:

```typescript
import { extractVideoId } from "@cliphy/shared";
```

**Step 5: Run tests**

Run: `pnpm test -- --run`
Expected: All 83 tests pass (extractVideoId tests now import from shared).

**Step 6: Run typechecks**

Run: `pnpm --filter shared typecheck && pnpm --filter server typecheck && pnpm --filter extension typecheck`
Expected: All pass.

**Step 7: Commit**

```bash
git add packages/shared/src/utils.ts packages/shared/src/index.ts apps/server/src/routes/queue.ts apps/server/src/routes/__tests__/queue.test.ts
git commit -m "move extractVideoId to @cliphy/shared"
```

---

### Task 2: Add `POST /api/queue/:id/process` endpoint

**Files:**

- Modify: `apps/server/src/routes/queue.ts` (add route before DELETE)
- Modify: `packages/shared/src/constants.ts` (add route constant)
- Test: `apps/server/src/routes/__tests__/queue.test.ts` (add process tests)

**Step 1: Add route constant**

In `packages/shared/src/constants.ts`, add to `API_ROUTES.QUEUE`:

```typescript
PROCESS: (id: string) => `/api/queue/${id}/process`,
```

**Step 2: Write failing tests**

Add to `apps/server/src/routes/__tests__/queue.test.ts`:

```typescript
describe("POST /queue/:id/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a pending queue item", async () => {
    // 1st from() → fetch item (pending, owned by user)
    const fetchChain = mockChain({
      data: {
        id: "sum-1",
        status: "pending",
        user_id: "test-user-id",
        youtube_video_id: "dQw4w9WgXcQ",
        video_title: null,
      },
    });
    // 2nd from() → update to processing
    const updateProcessingChain = mockChain({ data: { id: "sum-1" } });
    // 3rd from() → update to completed
    const updateCompletedChain = mockChain({
      data: {
        id: "sum-1",
        user_id: "test-user-id",
        youtube_video_id: "dQw4w9WgXcQ",
        video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        video_title: "Test",
        status: "completed",
        summary_json: { summary: "A summary", keyPoints: ["Point 1"], timestamps: ["0:00"] },
        error_message: null,
        created_at: "2026-02-20T10:00:00Z",
        updated_at: "2026-02-20T10:00:00Z",
      },
    });

    let callCount = 0;
    supabaseMock = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return fetchChain;
        if (callCount === 2) return updateProcessingChain;
        return updateCompletedChain;
      }),
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue/sum-1/process", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.status).toBe("completed");
    expect(json.summary.summaryJson).toBeDefined();
  });

  it("returns 404 for non-existent item", async () => {
    supabaseMock = {
      from: vi.fn().mockReturnValue(mockChain({ data: null, error: { message: "not found" } })),
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue/nonexistent/process", { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("returns 409 for non-pending item", async () => {
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValue(
          mockChain({ data: { id: "sum-1", status: "completed", user_id: "test-user-id" } }),
        ),
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue/sum-1/process", { method: "POST" });

    expect(res.status).toBe(409);
  });
});
```

Note: The "processes a pending queue item" test will need mocking of `fetchTranscript` and `summarizeTranscript`. Add these mocks at the top of the test file:

```typescript
vi.mock("../../services/transcript.js", () => ({
  fetchTranscript: vi.fn().mockResolvedValue("fake transcript text"),
  TranscriptNotAvailableError: class extends Error {},
}));

vi.mock("../../services/summarizer.js", () => ({
  summarizeTranscript: vi.fn().mockResolvedValue({
    summary: "A summary",
    keyPoints: ["Point 1"],
    timestamps: ["0:00"],
  }),
}));
```

**Step 3: Run tests to verify they fail**

Run: `pnpm test -- --run apps/server/src/routes/__tests__/queue.test.ts`
Expected: New tests FAIL (route doesn't exist yet).

**Step 4: Implement the endpoint**

In `apps/server/src/routes/queue.ts`, add imports at the top:

```typescript
import { fetchTranscript, TranscriptNotAvailableError } from "../services/transcript.js";
import { summarizeTranscript } from "../services/summarizer.js";
```

Add route before the DELETE handler (before line 329):

```typescript
// POST /:id/process — Process a queued item (fetch transcript + summarize)
queueRoutes.post("/:id/process", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  // Verify item exists, belongs to user, and is pending
  const { data: row, error: fetchError } = await supabase
    .from("summaries")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchError || !row) {
    return c.json({ error: "Queue item not found" }, 404);
  }

  if (row.status !== "pending") {
    return c.json({ error: "Item is not in pending state" }, 409);
  }

  // Mark as processing
  await supabase.from("summaries").update({ status: "processing" }).eq("id", id);

  try {
    const transcript = await fetchTranscript(row.youtube_video_id as string);
    const summaryJson = await summarizeTranscript(
      transcript,
      (row.video_title as string) ?? "Untitled Video",
    );

    // Update to completed
    const { data: updated, error: updateError } = await supabase
      .from("summaries")
      .update({
        status: "completed",
        summary_json: summaryJson,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !updated) {
      return c.json({ error: "Failed to update summary" }, 500);
    }

    return c.json({ summary: toSummary(updated) });
  } catch (err) {
    const errorMessage =
      err instanceof TranscriptNotAvailableError ? err.message : "Failed to generate summary";

    await supabase
      .from("summaries")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", id);

    return c.json({ error: errorMessage }, 422);
  }
});
```

**Step 5: Run tests**

Run: `pnpm test -- --run apps/server/src/routes/__tests__/queue.test.ts`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/shared/src/constants.ts apps/server/src/routes/queue.ts apps/server/src/routes/__tests__/queue.test.ts
git commit -m "add POST /api/queue/:id/process endpoint"
```

---

### Task 3: Add `processQueueItem` to extension API client

**Files:**

- Modify: `apps/extension/lib/api.ts`

**Step 1: Add the method**

Add to `apps/extension/lib/api.ts`:

```typescript
export async function processQueueItem(id: string) {
  return request<{ summary: Summary }>(API_ROUTES.QUEUE.PROCESS(id), {
    method: "POST",
  });
}
```

**Step 2: Typecheck**

Run: `pnpm --filter extension typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/extension/lib/api.ts
git commit -m "add processQueueItem to extension API client"
```

---

### Task 4: Add `contextMenus` permission

**Files:**

- Modify: `apps/extension/wxt.config.ts`

**Step 1: Add permission**

In `apps/extension/wxt.config.ts`, add `"contextMenus"` to the permissions array:

```typescript
permissions: ["storage", "activeTab", "tabs", "identity", "contextMenus"],
```

**Step 2: Build to verify**

Run: `pnpm build:extension`
Expected: PASS, manifest.json includes `contextMenus` permission.

**Step 3: Commit**

```bash
git add apps/extension/wxt.config.ts
git commit -m "add contextMenus permission to extension manifest"
```

---

### Task 5: Rewrite background service worker

**Files:**

- Modify: `apps/extension/entrypoints/background.ts`

**Step 1: Implement the full background worker**

Replace `apps/extension/entrypoints/background.ts` entirely:

```typescript
import type { ExtensionMessage } from "@cliphy/shared";
import { extractVideoId } from "@cliphy/shared";
import { signIn, signOut, isAuthenticated } from "../lib/auth";
import { addToQueue, processQueueItem } from "../lib/api";

/** Queue a video and process it. Returns the completed summary or throws. */
async function queueAndProcess(videoUrl: string) {
  const { summary } = await addToQueue({ videoUrl });
  const { summary: processed } = await processQueueItem(summary.id);
  return processed;
}

export default defineBackground(() => {
  // ── Context menu ──────────────────────────────────────────
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "add-to-cliphy",
      title: "Add to Cliphy",
      contexts: ["page"],
      documentUrlPatterns: ["*://*.youtube.com/watch*"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "add-to-cliphy") return;

    const url = info.pageUrl ?? tab?.url;
    if (!url || !extractVideoId(url)) return;

    try {
      await queueAndProcess(url);
    } catch (err) {
      console.error("[Cliphy] Context menu queue failed:", err);
    }
  });

  // ── Message handling ──────────────────────────────────────
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "VIDEO_DETECTED":
        // Log for now — user must explicitly add via popup or context menu
        console.log("[Cliphy] Video detected:", msg.video.videoId);
        break;

      case "ADD_TO_QUEUE": {
        const authed = isAuthenticated();
        if (!authed) {
          sendResponse({ success: false, error: "Not authenticated" });
          return true;
        }

        queueAndProcess(msg.videoUrl)
          .then((summary) => sendResponse({ success: true, summary }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true; // keep port open for async response
      }

      case "SIGN_IN":
        signIn()
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;

      case "SIGN_OUT":
        signOut()
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
    }

    return true;
  });
});
```

**Step 2: Build**

Run: `pnpm build:extension`
Expected: PASS

**Step 3: Typecheck**

Run: `pnpm --filter extension typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "wire up background worker with queue, process, and context menu"
```

---

### Task 6: Update design doc and run full CI

**Files:**

- Modify: `docs/plans/2026-02-21-background-worker-design.md`

**Step 1: Update design doc**

Update the design doc to reflect the final implementation (replace the PATCH approach with the `POST /api/queue/:id/process` approach, remove `QUEUE_STATUS` message since it wasn't needed).

**Step 2: Run full CI**

Run:

```bash
pnpm exec prettier --check .
pnpm lint
pnpm --filter shared typecheck
pnpm --filter extension typecheck
pnpm --filter server typecheck
pnpm build:extension
pnpm build:server
pnpm test -- --run
```

Expected: All pass.

**Step 3: Fix any issues, then commit**

```bash
git add -A
git commit -m "update background worker design doc"
```
