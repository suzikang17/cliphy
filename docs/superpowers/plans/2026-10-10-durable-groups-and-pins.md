# Durable Groups & Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tabs view a trustworthy tab manager: pin tabs (persisted, never pruned), close and resume whole groups, Trail on by default with free-form retention, and a stale-tab stow helper.

**Architecture:** Everything builds on stores that already exist — `clips` (bookmark tier), `pinned_items`, `page_tags`, `trail_items` — plus one new table, `closed_groups`, holding what was open when a group was closed. The extension keeps its local-cache-first pattern (instant render, best-effort server sync). Pinning = promote a page to a bookmark-tier clip + pin it; retention can never touch pinned pages because they are no longer in the Trail.

**Tech Stack:** Hono + Supabase (server, Vercel), WXT + React + TypeScript (extension), Vitest (+ jsdom, Testing Library) everywhere, `@cliphy/shared` for the contract.

**Spec:** `docs/superpowers/specs/2026-10-10-durable-groups-and-pins-design.md`

## Global Constraints

- Address + title only. Page text is never stored server-side (spec § Privacy).
- Required manifest `permissions` / `host_permissions` must not change (existing users would be disabled); only `commands` and optional permissions may.
- Chrome allows 4 global commands; `pin-page` (⌘⇧P) is the third. Do not add a fourth.
- Local cache is the source of truth for instant UI; server calls are best-effort and never block closing a tab.
- Migrations are applied with `psql "$DATABASE_URL" -f <file>` from `apps/server` (`.env.local` has `DATABASE_URL`); never `supabase db push`.
- Run `eval "$(fnm env)"` before node/pnpm. Run vitest suites on their own (chained commands have been killed with exit 144).
- Commit messages: imperative, concise, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests use allure labels (`layer("unit"); epic(...); feature(...)`) like their neighbours; extension tests import `test/browser-mock`.

## Review Focus

1. **Pinning a page that is already a clip (full tier)** — must reuse that clip (no duplicate), keep its enrichment, and still create the pin. Test in Task 2.
2. **Close group while the snapshot call fails** — tabs must still close and a local Resume row must exist (Trail is the guarantee). Test in Task 6.
3. **Resume with pages already open / more than 8 pages** — no duplicate tabs; new window above 8. Test in Task 6.
4. **Trail default flip for an existing user who turned it off** — `false` must stay `false`; only unset flips to on. Test in Task 4.
5. **Retention units** — "6 months" → 180 days, "forever" → null, and the server rejects 0 / >3650. Tests in Tasks 1 and 4.

---

### Task 1: Contract, migration, free-form retention (server)

**Files:**

- Modify: `packages/shared/src/types.ts` (append), `packages/shared/src/constants.ts` (`API_ROUTES.PINS.PAGE`, `API_ROUTES.TABS.GROUPS*`)
- Create: `apps/server/supabase/migrations/036_closed_groups.sql`
- Modify: `apps/server/src/services/trail.ts` (replace `RETENTION_CHOICES`), `apps/server/src/routes/trail.ts` (settings validation)
- Test: `apps/server/src/routes/__tests__/trail.test.ts`

**Interfaces:**

- Produces (shared):
  ```ts
  export interface ClosedGroupPage {
    url: string;
    title: string;
  }
  export interface ClosedGroup {
    key: string;
    label: string;
    pages: ClosedGroupPage[];
    closedAt: string;
  }
  export interface PinPageResponse {
    pin: PinnedItem;
    clip: Summary;
    created: boolean;
  }
  export const MAX_RETENTION_DAYS = 3650;
  API_ROUTES.PINS.PAGE = "/api/pins/page";
  API_ROUTES.TABS.GROUPS_CLOSED = "/api/tabs/groups/closed";
  API_ROUTES.TABS.GROUP_CLOSE = (key) => `/api/tabs/groups/${encodeURIComponent(key)}/close`;
  API_ROUTES.TABS.GROUP_RESUME = (key) => `/api/tabs/groups/${encodeURIComponent(key)}/resume`;
  ```
- Produces (server): `PUT /api/trail/settings` accepts `retentionDays: integer 1..3650 | null`.

- [ ] **Step 1: Write the failing retention tests** (replace the existing "settings accept forever (null) or the fixed choices only" test in `trail.test.ts`):

```ts
it("settings accept any 1–3650 days or forever, and reject the rest", async () => {
  svc.getRetentionDays.mockResolvedValue(null);
  expect(await (await app().request("/trail/settings")).json()).toEqual({ retentionDays: null });
  for (const ok of [1, 21, 180, 3650, null]) {
    expect(
      (await app().request("/trail/settings", json("PUT", { retentionDays: ok }))).status,
    ).toBe(200);
    expect(svc.setRetentionDays).toHaveBeenLastCalledWith("u1", ok);
  }
  for (const bad of [0, 3651, 2.5, "30", undefined]) {
    expect(
      (await app().request("/trail/settings", json("PUT", { retentionDays: bad }))).status,
    ).toBe(400);
  }
});
```

Also change the route-test mock: `vi.mock("../../services/trail.js", ...)` currently exports `RETENTION_CHOICES: [7, 30, 90, 365]` — replace with `MAX_RETENTION_DAYS: 3650`.

- [ ] **Step 2: Run to verify it fails**  
      Run: `cd apps/server && npx vitest run src/routes/__tests__/trail.test.ts`  
      Expected: FAIL — 21 and 180 return 400.

- [ ] **Step 3: Implement.** In `services/trail.ts` replace `export const RETENTION_CHOICES = [...]` with `export const MAX_RETENTION_DAYS = 3650;`. In `routes/trail.ts`:

```ts
const days = body.retentionDays;
const valid =
  days === null ||
  (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS);
if (!valid) {
  return c.json({ error: `retentionDays must be null or an integer 1–${MAX_RETENTION_DAYS}` }, 400);
}
```

(import `MAX_RETENTION_DAYS` instead of `RETENTION_CHOICES`.) Append the shared types/routes above. Write the migration:

```sql
-- apps/server/supabase/migrations/036_closed_groups.sql
-- What was open when a Tabs-view group was closed, so it can be resumed.
-- Address + title only. One row per user+group; a later close replaces it.
create table if not exists closed_groups (
  user_id   uuid not null references users(id) on delete cascade,
  group_key text not null,
  label     text not null,
  pages     jsonb not null default '[]',
  closed_at timestamptz not null default now(),
  primary key (user_id, group_key)
);
alter table closed_groups enable row level security;
```

- [ ] **Step 4: Run tests + typecheck**  
      Run: `cd apps/server && npx vitest run src/routes/__tests__/trail.test.ts && npx tsc --noEmit -p .` and `cd packages/shared && npx tsc --noEmit -p .`  
      Expected: PASS, no type errors.

- [ ] **Step 5: Apply the migration and verify**  
      Run: `cd apps/server && set -a && source .env.local && set +a && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/036_closed_groups.sql && psql "$DATABASE_URL" -At -c "select string_agg(column_name, ',') from information_schema.columns where table_name='closed_groups';"`  
      Expected: `user_id,group_key,label,pages,closed_at`.

- [ ] **Step 6: Commit**  
      `git add packages/shared/src apps/server/supabase/migrations/036_closed_groups.sql apps/server/src/services/trail.ts apps/server/src/routes/trail.ts apps/server/src/routes/__tests__/trail.test.ts && git commit -m "trail retention: any 1–3650 days or forever; closed_groups table; pins/groups contract"`

---

### Task 2: `POST /api/pins/page` (server)

**Files:**

- Create: `apps/server/src/services/pin-page.ts`
- Modify: `apps/server/src/routes/pins.ts` (register `/page` BEFORE `/:id` routes)
- Test: `apps/server/src/services/__tests__/pin-page.test.ts`, `apps/server/src/routes/__tests__/pins-page.test.ts`

**Interfaces:**

- Consumes: `extractWebMetadata(url)` (`services/extractors/webMetadata.ts`), `tagsForPages(userId, urls)` (`services/page-tags.ts`), `deleteTrailItem`/`listTrail` is not needed — delete by URL directly, `toClip`/`toPinnedItem` (`lib/mappers.ts`), `inngest.send({name:"clip/embed.requested"})`.
- Produces: `pinPage({ userId, url, title?, note? }): Promise<{ pin, clip, created }>`; route returns `PinPageResponse` (201 when the pin was created, 200 when it already existed).

- [ ] **Step 1: Write the failing service tests** (`pin-page.test.ts`, mocking supabase with the per-table queue pattern from `quick-save.test.ts`; mock `../extractors/webMetadata.js` → `{ title: "Lotus Bech – Drive" }`, mock `../page-tags.js` `tagsForPages`, mock `../../lib/inngest.js`):

```ts
it("creates a bookmark-tier clip with the page's tag and your name/note, removes the trail row, pins it", async () => {
  tagsForPages.mockResolvedValue(new Map([[URL, "freelance:lotus-bech"]]));
  const insertClip = chain({
    data: { id: "c1", source_url: URL, tags: ["freelance:lotus-bech"] },
    error: null,
  });
  const insertPin = chain({
    data: { id: "p1", kind: "clip", clip_id: "c1", position: 0 },
    error: null,
  });
  tables = {
    clips: [chain({ data: null }) /* no existing clip */, insertClip],
    trail_items: [chain({ error: null }) /* delete */],
    pinned_items: [chain({ data: null }) /* no existing pin */, insertPin],
  };
  const r = await pinPage({ userId: "u1", url: URL, title: "Mine", note: "waiting" });
  expect(insertClip.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      enrichment_tier: "metadata",
      source_url: URL,
      video_title: "Mine",
      user_notes: "waiting",
      tags: ["freelance:lotus-bech"],
      status: "completed",
    }),
  );
  expect(tables_used("trail_items")[0].delete).toHaveBeenCalled();
  expect(r).toMatchObject({ created: true, clip: { id: "c1" }, pin: { id: "p1" } });
});

it("reuses an existing clip (any tier) and an existing pin — idempotent", async () => {
  tables = {
    clips: [
      chain({ data: { id: "c9", source_url: URL, enrichment_tier: "full", tags: ["design"] } }),
    ],
    trail_items: [chain({ error: null })],
    pinned_items: [chain({ data: { id: "p9", kind: "clip", clip_id: "c9" } })],
  };
  const r = await pinPage({ userId: "u1", url: URL });
  expect(r).toMatchObject({ created: false, clip: { id: "c9" }, pin: { id: "p9" } });
  // never inserted a second clip or pin
});
```

Route test (`pins-page.test.ts`, mock `../../services/pin-page.js` and `../../lib/rateLimit.js`): 201 with `{pin, clip, created:true}`, 200 when `created:false`, 400 for non-web url, 429 when rate-limited.

- [ ] **Step 2: Run to verify they fail**  
      Run: `cd apps/server && npx vitest run src/services/__tests__/pin-page.test.ts src/routes/__tests__/pins-page.test.ts`  
      Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/pin-page.ts`:**

```ts
import { normalizeUrl, type PinnedItem, type Summary } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { toClip, toPinnedItem } from "../lib/mappers.js";
import { supabase } from "../lib/supabase.js";
import { detectSourceType } from "./detectSourceType.js";
import { extractWebMetadata } from "./extractors/webMetadata.js";
import { tagsForPages } from "./page-tags.js";

export interface PinPageInput {
  userId: string;
  url: string;
  title?: string;
  note?: string;
}

/**
 * Pin a page: find-or-create a bookmark-tier clip (any existing clip for the URL is
 * reused), carry the page's tag + your name/note into it, drop the page from the
 * Trail (it's kept as a clip now — retention can't touch it), and pin the clip once.
 */
export async function pinPage({ userId, url, title, note }: PinPageInput) {
  const { data: existing } = await supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .eq("source_url", url)
    .is("deleted_at", null)
    .maybeSingle();

  let clipRow = existing as Record<string, unknown> | null;
  if (!clipRow) {
    let md: Awaited<ReturnType<typeof extractWebMetadata>>;
    try {
      md = await extractWebMetadata(url);
    } catch {
      md = { title: url };
    }
    const tag = (await tagsForPages(userId, [url])).get(url);
    const { data, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: detectSourceType(url),
        source_url: url,
        enrichment_tier: "metadata",
        video_title: title || md.title || url,
        hero_image_url: md.heroImageUrl ?? null,
        source_metadata: { siteName: md.siteName, faviconUrl: md.faviconUrl },
        status: "completed",
        tags: tag ? [tag] : [],
        ...(note && { user_notes: note }),
      })
      .select("*")
      .single();
    if (error || !data) throw new Error("Failed to save clip");
    clipRow = data;
    await inngest.send({ name: "clip/embed.requested", data: { clipId: data.id } }).catch(() => {});
  }

  // Kept as a clip now → out of the Trail.
  await supabase
    .from("trail_items")
    .delete()
    .eq("user_id", userId)
    .eq("url", normalizeUrl(url) ?? url);

  const clipId = clipRow.id as string;
  const { data: pinExisting } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("user_id", userId)
    .eq("clip_id", clipId)
    .maybeSingle();
  if (pinExisting) {
    return { pin: toPinnedItem(pinExisting), clip: toClip(clipRow), created: false };
  }
  const { data: pin, error: pinErr } = await supabase
    .from("pinned_items")
    .insert({ user_id: userId, kind: "clip", layout: "tile", position: 0, clip_id: clipId })
    .select("*")
    .single();
  if (pinErr || !pin) throw new Error("Failed to create pin");
  return { pin: toPinnedItem(pin), clip: toClip(clipRow), created: true };
}
```

Route (in `pins.ts`, above `pinsRoutes.get("/:id/items")`):

```ts
pinsRoutes.post("/page", async (c) => {
  const userId = c.get("userId");
  let body: { url?: unknown; title?: unknown; note?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.url !== "string" || body.url.length > 2048 || !/^https?:\/\//.test(body.url)) {
    return c.json({ error: "A web page url is required" }, 400);
  }
  if (!checkRateLimit(`quick-save:${userId}`, 120, 60 * 60_000)) {
    return c.json({ error: "Too many saves", code: "RATE_LIMITED" }, 429);
  }
  try {
    const r = await pinPage({
      userId,
      url: body.url,
      title: typeof body.title === "string" ? body.title.slice(0, 500) : undefined,
      note:
        typeof body.note === "string" ? body.note.trim().slice(0, 2000) || undefined : undefined,
    });
    return c.json(r, r.created ? 201 : 200);
  } catch {
    return c.json({ error: "Failed to pin page" }, 500);
  }
});
```

Note: the `trail_items.url` column stores the normalized URL (see `captureTrail`), hence the `normalizeUrl` on delete. Note the trail's `pageKey` is in `page-tags.ts`; reuse it.

- [ ] **Step 4: Run tests + typecheck + lint**  
      Run: `cd apps/server && npx vitest run src/services/__tests__/pin-page.test.ts src/routes/__tests__/pins-page.test.ts && npx tsc --noEmit -p . && npx eslint src/services/pin-page.ts src/routes/pins.ts`  
      Expected: PASS.

- [ ] **Step 5: Commit**  
      `git add apps/server/src && git commit -m "POST /pins/page: pin a page as a bookmark-tier clip, out of the trail, idempotent"`

---

### Task 3: Closed groups + trail tag filter (server)

**Files:**

- Create: `apps/server/src/services/closed-groups.ts`
- Modify: `apps/server/src/routes/tabs.ts` (3 routes, registered before `/hints/:tag`), `apps/server/src/services/trail.ts` (`tag` filter in `listTrail`), `apps/server/src/routes/trail.ts` (`?tag=`)
- Test: `apps/server/src/routes/__tests__/tabs.test.ts` (add), `apps/server/src/services/__tests__/trail.test.ts` (add)

**Interfaces:**

- Produces: `closeGroup(userId, key, label, pages)`, `listClosedGroups(userId): ClosedGroup[]`, `resumeGroup(userId, key): ClosedGroup | null` (returns and deletes). `listTrail(userId, { q?, tag?, before?, limit })`.

- [ ] **Step 1: Failing tests.** In `tabs.test.ts` (mock `../../services/closed-groups.js`):

```ts
it("closes, lists and resumes a group", async () => {
  cg.closeGroup.mockResolvedValue({ closedAt: "2026-10-10T10:00:00.000Z" });
  let res = await app().request("/tabs/groups/tag%3Afreelance%3Alotus-bech/close", json("PUT", {
    label: "freelance › lotus-bech", pages: [{ url: "https://a.com", title: "A" }],
  }));
  expect(res.status).toBe(200);
  expect(cg.closeGroup).toHaveBeenCalledWith("u1", "tag:freelance:lotus-bech", "freelance › lotus-bech", [{ url: "https://a.com", title: "A" }]);

  cg.listClosedGroups.mockResolvedValue([{ key: "tag:x", label: "x", pages: [], closedAt: "t" }]);
  expect(await (await app().request("/tabs/groups/closed")).json()).toEqual({ groups: [{ key: "tag:x", label: "x", pages: [], closedAt: "t" }] });

  cg.resumeGroup.mockResolvedValue({ key: "tag:x", label: "x", pages: [{ url: "https://a.com", title: "A" }], closedAt: "t" });
  res = await app().request("/tabs/groups/tag%3Ax/resume", { method: "POST" });
  expect(await res.json()).toEqual({ pages: [{ url: "https://a.com", title: "A" }] });
  cg.resumeGroup.mockResolvedValue(null);
  expect((await app().request("/tabs/groups/nope/resume", { method: "POST" })).status).toBe(404);
});
it("close validates pages (1–100, web urls) and label", ...) // 400 cases
```

In `trail.test.ts`: `listTrail("u1", { tag: "design", limit: 10 })` adds `.contains("tags", ["design"])` to the query chain (add `contains` to that test's chain methods).

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/routes/__tests__/tabs.test.ts src/services/__tests__/trail.test.ts`

- [ ] **Step 3: Implement `services/closed-groups.ts`:**

```ts
import type { ClosedGroup, ClosedGroupPage } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";

export const MAX_CLOSED_PAGES = 100;

const toGroup = (r: Record<string, unknown>): ClosedGroup => ({
  key: r.group_key as string,
  label: r.label as string,
  pages: (r.pages as ClosedGroupPage[]) ?? [],
  closedAt: r.closed_at as string,
});

export async function closeGroup(
  userId: string,
  key: string,
  label: string,
  pages: ClosedGroupPage[],
) {
  const closedAt = new Date().toISOString();
  const { error } = await supabase
    .from("closed_groups")
    .upsert(
      {
        user_id: userId,
        group_key: key,
        label,
        pages: pages.slice(0, MAX_CLOSED_PAGES),
        closed_at: closedAt,
      },
      { onConflict: "user_id,group_key" },
    );
  if (error) throw new Error("Failed to save closed group");
  return { closedAt };
}

export async function listClosedGroups(userId: string): Promise<ClosedGroup[]> {
  const { data, error } = await supabase
    .from("closed_groups")
    .select("*")
    .eq("user_id", userId)
    .order("closed_at", { ascending: false });
  if (error) throw new Error("Failed to list closed groups");
  return (data ?? []).map(toGroup);
}

/** Returns the snapshot and removes it — resuming consumes the closed group. */
export async function resumeGroup(userId: string, key: string): Promise<ClosedGroup | null> {
  const { data } = await supabase
    .from("closed_groups")
    .delete()
    .eq("user_id", userId)
    .eq("group_key", key)
    .select("*");
  return data?.[0] ? toGroup(data[0]) : null;
}
```

Routes in `tabs.ts` (register before `/hints`):

```ts
tabsRoutes.get("/groups/closed", async (c) => {
  try {
    return c.json({ groups: await listClosedGroups(c.get("userId")) });
  } catch {
    return c.json({ error: "Failed to load closed groups" }, 500);
  }
});
tabsRoutes.put("/groups/:key/close", async (c) => {
  /* parse label (1–120) + pages (1–100, each {url https?, title ≤300}); closeGroup; 200 {closedAt} */
});
tabsRoutes.post("/groups/:key/resume", async (c) => {
  const g = await resumeGroup(c.get("userId"), decodeURIComponent(c.req.param("key")));
  return g ? c.json({ pages: g.pages }) : c.json({ error: "Not found" }, 404);
});
```

`listTrail`: add `tag?: string` to opts; `if (opts.tag) query = query.contains("tags", [opts.tag]);`. `routes/trail.ts`: pass `tag: c.req.query("tag")?.slice(0, 60)`.

- [ ] **Step 4: Run tests + tsc + eslint.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "closed groups: close / list / resume; trail list by tag"`

---

### Task 4: Trail on by default, first-run notice, retention units (extension)

**Files:**

- Modify: `apps/extension/lib/trail/tracker.ts` (`isTrailEnabled`), `apps/extension/lib/trail/useTrail.ts` (notice state), `apps/extension/components/tabs/TrailSection.tsx` (notice banner + retention picker)
- Create: `apps/extension/lib/trail/retention.ts`
- Test: `apps/extension/lib/trail/__tests__/tracker.test.ts` (add), `apps/extension/lib/trail/__tests__/retention.test.ts`, `apps/extension/components/tabs/__tests__/TrailSection.test.tsx` (add)

**Interfaces:**

- Produces: `isTrailEnabled()` → `true` unless stored `false`; `TRAIL_NOTICE_KEY = "trail:noticeSeen"`; `toDays({ amount, unit })` / `fromDays(days)` with `unit: "days"|"weeks"|"months"|"forever"`.

- [ ] **Step 1: Failing tests.**  
      `retention.test.ts`:

```ts
expect(toDays({ amount: 3, unit: "weeks" })).toBe(21);
expect(toDays({ amount: 6, unit: "months" })).toBe(180);
expect(toDays({ amount: 1, unit: "forever" })).toBeNull();
expect(toDays({ amount: 0, unit: "days" })).toBe(1); // clamped
expect(toDays({ amount: 99999, unit: "days" })).toBe(3650); // clamped
expect(fromDays(null)).toEqual({ amount: 1, unit: "forever" });
expect(fromDays(21)).toEqual({ amount: 3, unit: "weeks" });
expect(fromDays(180)).toEqual({ amount: 6, unit: "months" });
expect(fromDays(10)).toEqual({ amount: 10, unit: "days" });
```

`tracker.test.ts`: "trail is on when the key was never set, off only when explicitly false" — `storage.local.get` → `{}` ⇒ `isTrailEnabled()` true; `{ "trail:enabled": false }` ⇒ false.  
`TrailSection.test.tsx`: renders the first-run notice when `noticeSeen` is false and trail is on; "Keep" hides it and sets `trail:noticeSeen`; "Turn off" calls `setEnabled(false)`.

- [ ] **Step 2: Run to verify fail.** `cd apps/extension && npx vitest run lib/trail components/tabs/__tests__/TrailSection.test.tsx`

- [ ] **Step 3: Implement.**  
      `tracker.ts`: `return r?.[TRAIL_ENABLED_KEY] !== false;` and update the comment ("on by default; explicit false turns it off").  
      `retention.ts`:

```ts
export type RetentionUnit = "days" | "weeks" | "months" | "forever";
export const UNIT_DAYS: Record<Exclude<RetentionUnit, "forever">, number> = {
  days: 1,
  weeks: 7,
  months: 30,
};
export const MAX_DAYS = 3650;
export function toDays(r: { amount: number; unit: RetentionUnit }): number | null {
  if (r.unit === "forever") return null;
  const d = Math.round(r.amount) * UNIT_DAYS[r.unit];
  return Math.min(MAX_DAYS, Math.max(1, d));
}
export function fromDays(days: number | null): { amount: number; unit: RetentionUnit } {
  if (days === null) return { amount: 1, unit: "forever" };
  if (days % 30 === 0) return { amount: days / 30, unit: "months" };
  if (days % 7 === 0) return { amount: days / 7, unit: "weeks" };
  return { amount: days, unit: "days" };
}
```

`TrailSection.tsx`: replace the `<select>` of fixed days with `<input type=number min=1>` + `<select>` of units ("Keep closed tabs for [3] [weeks ▾]"; choosing _forever_ hides the number); on change call `trail.setRetention(toDays(...))`. Add the notice banner above the list:

> Cliphy now remembers tabs you close — address and title only, never page content — so nothing is lost. **[Keep]** **[Turn off]**

shown when `trail.enabled && !noticeSeen`; `useTrail` loads/sets `trail:noticeSeen` (storage.local).

- [ ] **Step 4: Run tests + typecheck + eslint.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "trail on by default with a first-run notice; retention in days/weeks/months/forever"`

---

### Task 5: Page pins (extension)

**Files:**

- Create: `apps/extension/lib/tabs/pins.ts`, `apps/extension/components/tabs/PinnedGroup.tsx`
- Modify: `apps/extension/lib/api.ts` (`pinPage`, `getPins` reuse, `deletePin` reuse), `apps/extension/lib/tabs/shortcuts.ts` (`p` → `pinTab`), `apps/extension/components/tabs/TabRow.tsx` (📌 + menu Pin/Unpin), `apps/extension/components/tabs/TabsView.tsx` (Pinned group first; dispatch `pinTab`), `apps/extension/components/tabs/ShortcutHelp.tsx` (⌘⇧P row via `commands.getAll` — automatic), `apps/extension/wxt.config.ts` (`pin-page` command), `apps/extension/entrypoints/background.ts` (handler)
- Test: `apps/extension/lib/tabs/__tests__/pins.test.ts`, `apps/extension/components/tabs/__tests__/PinnedGroup.test.tsx`, `apps/extension/components/tabs/__tests__/TabsView.shortcuts.test.tsx` (add `p`)

**Interfaces:**

- Produces:
  ```ts
  // lib/tabs/pins.ts
  export interface PagePin {
    pinId: string;
    clipId: string;
    url: string;
    key: string /* normalized */;
    title: string;
  }
  export function pagePinsFrom(pins: PinnedItem[]): PagePin[]; // kind === "clip" && clipUrl
  export function usePagePins(authed: boolean | null): {
    pins: PagePin[];
    byKey: Map<string, PagePin>;
    isPinned(url): boolean;
    pin(tab: { url; title; note? }): Promise<void>;
    unpin(url): Promise<void>;
    undo: { text; run } | null;
  };
  // lib/api.ts
  export async function pinPage(body: {
    url: string;
    title?: string;
    note?: string;
  }): Promise<PinPageResponse>;
  ```
- Consumes: `getPins()`, `deletePin(id)` (exist), `readSnapshot`/`writeSnapshot` from `lib/newtab-cache` (so the new-tab board sees new pins immediately), `getTabMeta(url)` for name/note, `showSaveToast`/`updateSaveToast` for the ⌘⇧P toast.

- [ ] **Step 1: Failing tests.**  
      `pins.test.ts`: `pagePinsFrom` keeps only clip pins with a URL and normalizes keys; `usePagePins` (renderHook, mock `../../api`): loads pins, `isPinned` matches tracking-param variants, `pin()` is optimistic (row appears before the request resolves) and rolls back + sets `undo` text on failure, `unpin()` optimistic with Undo re-pinning.  
      `PinnedGroup.test.tsx`: an open pin renders "open" and activates the tab; a closed pin opens a new tab (`browser.tabs.create`); `x` on a closed pin unpins.  
      `TabsView.shortcuts.test.tsx`: `p` on the selected row calls `pin` with that tab's url/title.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** Key points:
  - `usePagePins`: initial `readSnapshot()` → `pagePinsFrom(snap.pins)` for instant paint, then `getPins()`; after `pin`/`unpin` call `writeSnapshot({ ...snap, pins })` so the new-tab board updates too.
  - `TabsView`: `const pagePins = usePagePins(org.authed)`; render `<PinnedGroup pins={pagePins.pins} tabs={org.tabs} …/>` above `DuplicatesPanel`; rows for closed pins are part of `rows` for keyboard nav (extend `visibleRows` input with a synthetic group `{ key: "pinned", kind: "pinned" }` whose "tabs" are `OpenTab`-shaped objects with `id = -1 - index` and a `pinUrl`; `activate` on such a row → `tabs.create`). Open pinned tabs stay in their tag group and get `pinned` prop → 📌.
  - `shortcuts.ts`: `{ action: "pinTab", keys: ["p"], label: "Pin / unpin tab" }`.
  - Manifest: `"pin-page": { suggested_key: { default: "Ctrl+Shift+P", mac: "Command+Shift+P" }, description: "Pin this page to Cliphy" }`.
  - Background: on `pin-page`, toast `{ phase: "saving", title }` → `pinPage({ url, title: meta.title ?? tab.title, note: meta.note })` → toast `{ phase: "saved", title, tags: clip.tags, suggested: [], video: false }` with message text "Pinned" (add an optional `label` field to `SaveToastState` saved phase; default "Saved to Cliphy").

- [ ] **Step 4: Run all extension tests + typecheck + eslint + build; check the built manifest has 3 commands and unchanged required permissions.**  
      Run: `cd apps/extension && npx vitest run --reporter=dot; pnpm typecheck; npx eslint lib components entrypoints wxt.config.ts; pnpm build && node -e 'const m=require("./.output/chrome-mv3/manifest.json");console.log(m.permissions, Object.keys(m.commands))'`  
      Expected: `[storage,tabs,identity,contextMenus,sidePanel,favicon,activeTab]`, commands `[open-tabs-view, save-page, pin-page]`.

- [ ] **Step 5: Commit** — `git commit -m "tabs view: pin tabs (p, Cmd+Shift+P), Pinned group, pins never pruned"`

---

### Task 6: Durable groups (extension)

**Files:**

- Create: `apps/extension/lib/tabs/closedGroups.ts`, `apps/extension/components/tabs/ClosedGroups.tsx`
- Modify: `apps/extension/lib/api.ts` (`getClosedGroups`, `closeGroupSnapshot`, `resumeGroup`, `listTrail` already takes `q`; add `tag`), `apps/extension/lib/tabs/useTabOrganizer.ts` (`closeGroup(group)`, `resumeGroup(key)`), `apps/extension/components/tabs/TabGroupSection.tsx` (counts line, `Close group`, `+N from trail`), `apps/extension/components/tabs/TabsView.tsx` (ClosedGroups section between groups and Trail; `⇧C` dispatch), `apps/extension/lib/tabs/shortcuts.ts` (`C` → `closeGroup`)
- Test: `apps/extension/lib/tabs/__tests__/closedGroups.test.ts`, `apps/extension/lib/tabs/__tests__/useTabOrganizer.groups.test.ts`, `apps/extension/components/tabs/__tests__/ClosedGroups.test.tsx`

**Interfaces:**

- Produces (pure, `closedGroups.ts`):
  ```ts
  export function pagesToResume(snapshot: ClosedGroupPage[], pinned: PagePin[], openUrls: string[]): ClosedGroupPage[] // snapshot ∪ pinned, minus already open (normalized), deduped
  export const NEW_WINDOW_ABOVE = 8;
  export function groupCounts(group: TabGroup, pins: PagePin[], trailCount: number): { open: number; pinned: number; trail: number }
  export async function cacheClosedGroups(groups: ClosedGroup[]) / loadCachedClosedGroups()  // storage.local "tabs:closedGroups"
  ```
- Hook: `closeGroup(group)` → snapshot pages = group.tabs (url,title) → `closeGroupSnapshot(key,label,pages)` best-effort (on failure, cache a local `ClosedGroup` with `closedAt = now`) → `closeTabsAndAdvance(ids)`. `resumeGroup(key)` → `resumeGroup` API (fallback: cached local snapshot) → `pagesToResume(...)` → `tabs.create` each (in `windows.create({ url: [...] })` when > 8) → remove from local cache.

- [ ] **Step 1: Failing tests.**  
      `closedGroups.test.ts`: `pagesToResume` dedupes against open tabs by normalized URL and against itself; includes pinned pages not in the snapshot; `groupCounts`.  
      `useTabOrganizer.groups.test.ts` (renderHook, mocks like `useTabOrganizer.merge.test.ts`): (a) `closeGroup` calls the snapshot API with `{label, pages}` then `tabs.remove` with the group's ids; (b) **snapshot API rejects → tabs still removed and a local closed group exists**; (c) `resumeGroup` with 3 pages, 1 already open → 2 `tabs.create`; (d) 10 pages → one `windows.create({ url: [...10] })`.  
      `ClosedGroups.test.tsx`: renders "label · N tabs · closed 2h ago · Resume"; Enter/click calls `resumeGroup(key)`.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** per the interfaces. In `TabGroupSection`, under the header for `kind === "tag"`: `<p class="…faint">{open} open · {pinned} pinned · {trail} in trail</p>` (trail count from `GET /api/trail?tag=…&limit=1` is too chatty — instead `TabsView` loads trail counts per tag once per open with a single `GET /api/trail?limit=100` grouped client-side by first tag, cached 5 min; "+N from trail" menu item opens an inline list with per-row reopen and "Open all" (confirm when N > 10)). Add `Close group` to the ⋯ menu (`⇧C`).

- [ ] **Step 4: Run tests + typecheck + eslint + build.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "tabs view: close a whole group and resume it later; group counts; trail pages per group"`

---

### Task 7: Stale-tab stow (extension)

**Files:**

- Create: `apps/extension/lib/tabs/stale.ts`
- Modify: `apps/extension/components/tabs/TabRow.tsx` (stale marker), `apps/extension/components/tabs/TabsView.tsx` (header "Stow stale (N)" + `⇧W`), `apps/extension/lib/tabs/shortcuts.ts`
- Test: `apps/extension/lib/tabs/__tests__/stale.test.ts`

- [ ] **Step 1: Failing test** — `isStale({ lastAccessed: now - 3d - 1 }, now)` true; `now - 3d + 1` false; `lastAccessed: 0` (unknown) false; `staleTabs(tabs, pinnedKeys)` excludes pinned and active tabs.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** — `STALE_AFTER_MS = 3 * 86_400_000`; `staleTabs` returns tabs sorted oldest first; TabsView: `Stow stale (N)` button (hidden when N = 0) → `org.stowTabs(stale)`; `TabRow` gets a faint "stale" chip when `isStale`.
- [ ] **Step 4: Run tests + tsc + eslint + build.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "tabs view: mark tabs untouched for 3+ days and stow them in one click"`

---

### Task 8: Docs

**Files:**

- Modify: `apps/server/src/pages/privacy.html` (Trail paragraph: on by default, retention wording), `docs/decisions/0050-trail-opt-in-closed-tabs-kept-forever-by-default.md` (superseded note → this spec), `docs/providers.md`? no. `docs/devlog/` entry via `/devlog`, `docs/RESUME.md`.
- [ ] **Step 1:** Edit privacy: "On by default when you're signed in… turn it off in the Tabs view… kept for the period you choose (days, weeks, months) or forever; pinned pages and closed-group snapshots are kept regardless."
- [ ] **Step 2:** Add to ADR 0050 top: `> **Superseded (2026-10-10):** Trail is now on by default with a first-run notice; retention is free-form. See spec 2026-10-10-durable-groups-and-pins.`
- [ ] **Step 3:** `lore reindex decision && lore validate decision`; devlog entry; commit `docs: trail default + durable groups; supersede ADR 0050`.

---

## Self-review notes

- Spec coverage: pins (T2, T5), durable groups (T3, T6), trail default + retention (T1, T4), stale stow (T7), privacy/ADR (T8), ⌘⇧P (T5), "+N from trail" (T3 tag filter, T6 UI). ✔
- Review Focus 1 → T2 test "reuses an existing clip"; 2 → T6 test (b); 3 → T6 tests (c)(d); 4 → T4 tracker test; 5 → T1 + T4 tests. ✔
- Type consistency: `PagePin`, `ClosedGroup(Page)`, `PinPageResponse` defined in T1/T5 and used by name in T6. `closeGroupSnapshot` (api) vs `closeGroup` (hook) are distinct on purpose.
