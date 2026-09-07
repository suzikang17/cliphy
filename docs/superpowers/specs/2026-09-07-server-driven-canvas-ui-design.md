---
type: spec
date: 2026-09-07
title: Server-Driven Canvas UI
---

# Server-Driven Canvas UI — Design Spec

**Date:** 2026-09-07
**Status:** Approved, pre-implementation
**Scope:** Subproject B of "ship UI changes without a store submission". Subproject A
(staging release channel) is deferred — see Deferred.

## Context

Every UI change in the extension currently requires a Chrome Web Store submission and
review, which turns a copy tweak into a 1–3 day round trip. The goal is to move the
surfaces that churn most — onboarding, upsell, empty states, banners — behind a
**server-described UI**: the API returns a JSON description built from a fixed
vocabulary of primitives, and the extension renders it with native React components.
Changing those surfaces then costs a `vercel deploy` (~1 minute) instead of a review.

This is the Intercom Canvas Kit model. MV3 permits it: the remote-code restriction
bans JS, WASM and anything _executed_, and explicitly permits remote JSON
configuration and data. A declarative UI description is data. The line we do not
cross is a JSON mini-language the client evaluates — the vocabulary stays closed and
non-Turing-complete.

Tailwind v4 already makes this cheap. `apps/extension/assets/main.css` declares the
theme via `@theme`, and the built CSS ships ~150 custom properties on `:root`
(`--color-*`, `--spacing`, `--radius-*`, `--text-*`, `--font-weight-*`, `--shadow-*`).
Dark mode is implemented by _redefining those variables_ under
`@media (prefers-color-scheme: dark)`. So a server that sends **token names** gets
correct dark mode for free and is structurally incapable of emitting an off-palette
colour. No Tailwind upgrade is required (4.2.0 installed, 4.3.3 latest, same `@theme`
behaviour).

Two hard boundaries constrain the design, both discovered by walking the existing code:

- **Server-owned live data.** `sidepanel/App.tsx:112` holds a direct Supabase Realtime
  subscription (deliberately outside the background SW so it survives shutdown), with a
  never-downgrade-status guard at `:141` and polling fallback at `:441`.
  `lib/supabase.ts` `toSummary` maps that payload and applies client-side defaults.
- **Client-only private data.** `SuggestedTiles`, `CaptureBar`, `BatchTabsButton`,
  `StowTabsPanel` and `is-active-tab` read `browser.tabs` / `browser.history`. The
  server does not have this data and must never receive it — `history` is an optional
  runtime permission precisely to avoid that, and `_favicon/*` is used to avoid a
  third-party leak.

## Goals

- Onboarding, upgrade prompt, empty states and banners render from a server-supplied
  canvas, changeable by deploying the server alone.
- A canvas failure is never user-visible: every canvased surface keeps its current
  React component as a fallback.
- The schema is level 2 (static composition + a closed action set) but shaped so
  level 3 (bindings, repeats, local state) slots in without a breaking rewrite.
- The server can never cause private browser state to be read or transmitted.
- Perceived latency on canvased surfaces is ~0 after first load.

## Non-Goals (this phase)

- Level 3: `bind`, `visibleIf`, `Repeat`, client-state mutation. Reserved in the types,
  rejected by the v1 renderer.
- Canvasing any surface that shows live summary status or client-only browser state.
- Database-backed canvases and an admin editor — canvases are TypeScript in
  `apps/server`, deployed with the server.
- A staging release channel (subproject A).
- Sharing canvases with `apps/mobile` (Tailwind v3 + NativeWind — different token layer).

## Architecture

```
apps/server/src/canvases/                     packages/shared/src/canvas.ts
  onboarding.ts   ─┐                            CanvasNode, Sx, CanvasAction,
  upgradePrompt.ts ├─→ registry.ts               CanvasEnvelope, CANVAS_SCHEMA_VERSION,
  emptyInbox.ts   ─┘        │                    validateCanvas()   ← pure, shared
  banner.ts                 │                          ▲
                            ▼                          │ imported by both ends
              GET /api/canvases  (authenticated)       │
              X-Canvas-Schema: <n>  →  { schemaVersion, revision, ttlSeconds,
                                          surfaces: { onboarding: <node>, ... } }
                            │
                            ▼
apps/extension
  lib/canvas-cache.ts        read/write snapshot in browser.storage (SWR)
  components/canvas/
    validate.ts              envelope → CanvasNode | null      (pure, tested)
    style.ts                 Sx → CSSProperties via var()      (pure, tested)
    render.tsx               CanvasNode → React elements
    CanvasBoundary.tsx       <CanvasBoundary surface fallback={<Native/>}>
                               renders canvas, or fallback on any failure
```

Canvas definitions live in TypeScript in `apps/server`, type-checked against the shared
schema, reviewable in PRs. Moving them to the database later changes nothing on the
client, which only ever sees JSON.

## Schema

New file `packages/shared/src/canvas.ts`, alongside `tags.ts` and `masonry.ts` — pure
cross-app logic imported by both server and extension, so the wire format is
type-checked at both ends.

```ts
export const CANVAS_SCHEMA_VERSION = 1;

export type CanvasSurface = "onboarding" | "upgrade_prompt" | "empty_inbox" | "banner";

export type CanvasNode =
  | { type: "Box"; sx?: Sx; children?: CanvasNode[] }
  | { type: "Stack"; dir: "row" | "col"; sx?: Sx; children: CanvasNode[] }
  | { type: "Text"; value: string; sx?: Sx }
  | { type: "Icon"; path: string; size?: number; sx?: Sx } // raw SVG path data
  | { type: "Image"; url: string; alt: string; sx?: Sx }
  | {
      type: "Button";
      label: string;
      action: CanvasAction;
      pendingLabel?: string;
      variant?: "primary" | "ghost";
      sx?: Sx;
    }
  | { type: "Divider"; sx?: Sx }
  | { type: "Spacer"; size: Scale };
```

`Icon` taking raw path data is deliberate: it means new icons and illustrations ship
server-side forever without ever adding an asset to the bundle. `UpgradePrompt`'s
inline star SVG is the first consumer.

**Reserved for level 3** — present in the type union and in `validateCanvas`'s
known-type list, but rejected at schema version 1 with a clear reason:
`Repeat` (`source`, `as`, `child`), `Toggle`, `Input`, and the node-level fields
`bind` and `visibleIf`. Reserving them now is what keeps tier-2/3 surfaces from forcing
a wire-format break later.

### Style object

```ts
interface Sx {
  bg?: ColorToken;
  fg?: ColorToken;
  borderColor?: ColorToken;
  p?: Scale;
  px?: Scale;
  py?: Scale;
  mt?: Scale;
  mb?: Scale;
  gap?: Scale;
  radius?: "md" | "lg" | "xl";
  shadow?: "brutal" | "brutal-sm";
  text?: "xs" | "sm" | "lg" | "xl" | "2xl";
  weight?: "normal" | "medium" | "semibold" | "bold" | "extrabold" | "black";
  align?: "start" | "center" | "end";
  justify?: "start" | "center" | "between";
  w?: "full" | "auto";
  borderWidth?: 0 | 2;
}

type Scale = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 | 8;
type ColorToken =
  | "surface"
  | "surface-secondary"
  | "surface-raised"
  | "border-hard"
  | "border-soft"
  | "border-muted"
  | "text"
  | "text-body"
  | "text-secondary"
  | "text-muted"
  | "text-faint"
  | "accent-surface"
  | "warn-surface"
  | "error-surface"
  | "upsell-surface"
  | "upsell-fg"
  | "upsell-accent"
  | `neon-${100 | 200 | 400 | 500 | 600 | 700 | 800 | 900}`;
```

`ColorToken` is a closed union matching the `@theme` block. The server cannot name a
colour that is not a declared token, and therefore cannot emit anything that breaks in
dark mode.

### Style mapping

`style.ts` is a pure function with no Tailwind involvement — **class name strings are
never sent over the wire**, because Tailwind v4's JIT only compiles classes it finds in
source at build time, so a server-sent class would silently render unstyled.

```
{ bg: "surface-raised", px: 4, radius: "lg", text: "sm", weight: "semibold" }
  →
{ background: "var(--color-surface-raised)",
  paddingInline: "calc(var(--spacing) * 4)",
  borderRadius: "var(--radius-lg)",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--font-weight-semibold)" }
```

MV3's default extension CSP is `script-src 'self'; object-src 'self'` — `style-src` is
unconstrained, and React `style` props are DOM property assignments regardless, so
inline styles are fine.

Composed utilities such as `@utility press-down` are class-based, not variables. They
are exposed as the `Button` `variant` values, which map to local classes — not
composable remotely.

### Actions

```ts
export type CanvasAction =
  | { kind: "dismiss" }
  | { kind: "complete" }
  | { kind: "open_checkout" }
  | { kind: "navigate"; to: "sidepanel" | "summaries" | "settings" }
  | { kind: "open_url"; url: string }; // https only, origin allowlisted client-side
```

The vocabulary is closed and every action is executed by the client with a payload the
**client** decides. There is deliberately no generic `post` action and no way for a
canvas to name client data to include in a request — otherwise
`{ kind: "post", include: "browser.tabs" }` would be an exfiltration primitive. The
canvas comes from our own server over TLS, so the likelihood is low; this is
least-authority, and free to design in now versus retrofit later.

`Button.pendingLabel` exists because the client owns transient action state. The server
describes that a pending state exists and what it says; the client owns whether it is
active. This is how `UpgradePrompt`'s `loading` flag survives the port.

### Envelope and version negotiation

```ts
export interface CanvasEnvelope {
  schemaVersion: number;
  revision: string; // opaque; cache comparison only
  ttlSeconds: number;
  surfaces: Partial<Record<CanvasSurface, CanvasNode>>;
}
```

Cache semantics, stated exactly so they are not re-derived at implementation time:

- The extension fetches `/api/canvases` **once per session**, on first use of any
  canvased surface, and writes the envelope to `browser.storage`.
- Rendering always reads the cache first and paints immediately; the fetch revalidates
  behind it. This is the `newtab-cache.ts` stale-while-revalidate pattern.
- `revision` is compared on fetch: unchanged → keep the cached envelope (no re-render);
  changed → replace it and re-render canvased surfaces.
- `ttlSeconds` bounds only how stale a cached canvas may be **when the fetch fails**.
  Past TTL with no successful fetch, the cached canvas is discarded and the surface
  renders its native fallback, so an indefinitely offline client cannot be pinned to an
  arbitrarily old UI.

The client sends `X-Canvas-Schema: 1`. The server returns only surfaces expressible at
that version and omits any it cannot express — an omitted surface renders its native
fallback. This is what allows a new primitive to be added: ship the client that
understands it, wait for adoption, then start using it server-side. Older installs keep
rendering fallbacks rather than breaking.

## Server

`GET /api/canvases`, authenticated, added to `API_ROUTES` in
`packages/shared/src/constants.ts` as `CANVASES: "/api/canvases"` and mounted in
`app.ts` next to the existing routes.

`apps/server/src/canvases/registry.ts` maps each surface to a builder:

```ts
type CanvasBuilder = (ctx: CanvasContext) => CanvasNode | null;
interface CanvasContext {
  plan: string;
  schemaVersion: number;
}
```

Returning `null` means "no canvas for this user" → the client renders native. Builders
receive only what they need to vary copy (currently `plan`); they never receive or emit
clip data. Each builder's return value is type-checked against `CanvasNode` at compile
time, so a malformed canvas cannot be deployed.

## Extension surface

- **`lib/canvas-cache.ts`** — mirrors `lib/newtab-cache.ts` exactly, including its
  posture: a corrupt or missing value is not an error, just a cold start, and a failed
  write must never break the page.
- **`components/canvas/CanvasBoundary.tsx`** — the integration point:

  ```tsx
  <CanvasBoundary
    surface="onboarding"
    fallback={<Onboarding onComplete={done} />}
    handlers={{ complete: done }}
  />
  ```

  Renders the cached or fetched canvas; renders `fallback` if the canvas is absent,
  stale beyond TTL and unfetchable, fails validation, or throws while rendering.

- Fetch happens once per session against `/api/canvases` and is cached, so the whole
  set costs one round trip (measured against prod `api.cliphy.app`: ~285ms median on a
  fresh connection, ~95ms warm, 647ms cold worst case) and every surface after the first
  paint renders from cache at ~0ms.

## Invariants

These are properties the implementation must preserve, not guidelines:

1. **A canvas never contains mutable domain data.** Baking `status: "processing"` into a
   node creates a second source of truth racing Realtime — and it sits outside the
   never-downgrade guard at `sidepanel/App.tsx:141`, so a cached canvas could visibly
   walk a summary backwards from `done` to `processing`. Dynamic values arrive only via
   level-3 `bind`, resolved client-side.
2. **Bindings resolve against mapped domain objects, never raw DB rows.**
   `toSummary` applies client-side defaults (`sourceType ?? "youtube"`,
   `enrichmentTier ?? "full"`); binding to the row would read `undefined` where the
   native component shows a value.
3. **The server is never sent, and can never request, client-private state.** Tab URLs
   and history stay local. Level-3 `Repeat` binds to a client-registered source and the
   server sees no values — it describes the shape of a list it cannot read.
4. **Every canvased surface keeps a native fallback.** The worst failure mode is "you
   see last week's onboarding", never a blank screen.

## Prerequisite work

The plan assumes components style via tokens. Two current files do not, and one lint
rule stops the drift recurring:

1. **`UpgradePrompt.tsx`** uses class-based dark variants —
   `bg-neon-100 dark:bg-neon-900/40`, `dark:text-neon-400`, `dark:bg-transparent` —
   which are not expressible as a single token name. Add semantic tokens
   `--color-upsell-surface`, `--color-upsell-fg`, `--color-upsell-accent` to `@theme`
   and the dark block, and convert the component to them.
2. **`TagEditor.tsx`** (new, `ff9700a`) hardcodes seven hex literals that are exact
   duplicates of declared tokens — `#ede0f8`→`neon-100`, `#7a3fb0`→`neon-700`,
   `#9358c7`→`neon-600`, `#b88ae2`→`neon-400`, `#221028`→`neon-900`,
   `#505050`→dark `border-hard`, `#1e1e1e`→dark `surface` — plus `border-black` and
   `bg-white`. Convert to tokens.
3. **ESLint rule** banning hex literals and `dark:` colour variants inside `className`.
   Without it the token surface keeps eroding and every new component becomes pre-work
   for canvasing.

## Error handling

- Unknown node type, unknown token, unknown action kind, or a reserved level-3 field at
  schema version 1 → `validateCanvas` rejects the **whole** canvas for that surface and
  returns `null`. Partial rendering of a canvas we do not fully understand is worse than
  the fallback.
- Fetch failure → serve cache if present, else fallback. Never blocks paint.
- A throw inside `render.tsx` → caught by `CanvasBoundary`, fallback rendered, reported
  to Sentry once per surface per session (not per render).
- `open_url` with a non-https or non-allowlisted origin → action dropped, logged.

## Testing

- `validate.ts`: unit tests for each rejection path — unknown node type, unknown colour
  token, out-of-scale spacing, unknown action kind, level-3 field at v1, and a valid
  canvas round-tripping.
- `style.ts`: unit tests that every `Sx` key maps to the expected `var()`/`calc()`
  string, and that every `ColorToken` corresponds to a variable actually declared in
  `main.css` (guards against a token being renamed in CSS but not in the union).
- `render.tsx`: render tests per surface asserting the canvas output matches the native
  component's visible text and action wiring.
- `CanvasBoundary`: a malformed canvas renders the native fallback; a canvas that throws
  renders the native fallback.
- `canvas-cache.ts`: corrupt stored value → cold start, not a throw.
- Server: `registry` builders return schema-valid nodes for each plan.

## Build sequence

1. Prerequisite token work + ESLint rule (independent, mergeable alone).
2. `packages/shared/src/canvas.ts` — types, `validateCanvas`, tests.
3. `components/canvas/style.ts` + tests.
4. `components/canvas/render.tsx`, `CanvasBoundary.tsx` + fallback tests.
5. `apps/server/src/canvases/` registry + `GET /api/canvases` + tests.
6. `lib/canvas-cache.ts` + fetch wiring.
7. Canvas **onboarding** first — one action, no plan variance, no live data.
8. Canvas **upgrade_prompt** — two actions plus pending state; exercises the parts
   onboarding does not.

Verification for 7 and 8: change the canvas server-side, deploy, confirm the extension
picks it up with no rebuild.

## Risks

- **Token drift** re-erodes the substrate. Mitigated by the lint rule in step 1; without
  it this decays quietly.
- **Schema churn.** A new primitive cannot be used server-side until clients ship it.
  Version negotiation handles it correctly but the lag is real — batch primitive
  additions rather than trickling them.
- **Scope creep into a second UI framework.** Mitigated by the surface tiers: masonry
  drag, the editor and `StowTabsPanel` stay native permanently.
- **First-run onboarding has no cache** and pays full latency. Acceptable: onboarding
  follows sign-in, already a network moment.

## Surface tiers

| Surface                                           | Data                            | Tier                                  |
| ------------------------------------------------- | ------------------------------- | ------------------------------------- |
| Onboarding, upgrade prompt, empty states, banners | None                            | Canvas in v1                          |
| Queue rows, summary detail                        | Server-owned, live              | Level 3 — bind to Realtime state      |
| Suggested tiles, capture bar, batch tabs          | Client-only, private            | Level 3 — `Repeat` over local sources |
| Stow panel, masonry drag, tag editor              | Client-only + heavy interaction | Stay native                           |

## Deferred

- Level 3: `bind`, `visibleIf`, `Repeat`, client data-source registry.
- Database-backed canvases with an admin editor (client unaffected — it only sees JSON).
- `canvases_changed` broadcast over the existing Realtime channel, so a canvas change
  lands live instead of at next fetch. No new infra; out of v1.
- Subproject A: unlisted Chrome Web Store staging item published from CI. Note that an
  unlisted item still goes through review — it buys isolation from real users and an
  install link for any device, not faster updates.
