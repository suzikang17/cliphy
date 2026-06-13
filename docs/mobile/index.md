# Mobile app docs

Documentation for the Cliphy mobile app (`apps/mobile`) — an Expo/React Native iOS app (Android-capable, untested) that mirrors the core product: queue YouTube videos, read AI summaries.

> Last full revision: 2026-06-10. When mobile architecture or workflow changes, update the relevant file here (same convention as the rest of `docs/` — see `CLAUDE.md`).

| You want…                                                                      | Look in                              |
| ------------------------------------------------------------------------------ | ------------------------------------ |
| **Stack, project structure, navigation, auth & data flow**                     | [`architecture.md`](architecture.md) |
| **What the app can do today, with file pointers**                              | [`features.md`](features.md)         |
| **Hard-won workarounds & sharp edges** (polyfills, share-intent, OAuth, dedup) | [`gotchas.md`](gotchas.md)           |
| **Builds, OTA updates, TestFlight, env vars, local dev**                       | [`deployment.md`](deployment.md)     |

## Quick orientation

- **Run locally:** `pnpm dev:mobile` (repo root) + a **dev client build** on the phone — Expo Go does _not_ work (native modules).
- **Source of truth for product/server behavior:** the server docs and `docs/architecture.md`; the mobile app is a thin client over the same `/api/*` used by the web app and extension.
- **Original build plan:** [`../superpowers/plans/2026-04-10-mobile-app.md`](../superpowers/plans/2026-04-10-mobile-app.md) (historical — this dir describes what actually shipped).

## Related ADRs

- **0039** — Windowed atomic dedup for queue enqueue (the share-sheet triple-queue fix; mobile is the client half)
