# Mobile deployment

## Local development

```bash
pnpm dev:mobile        # from repo root — starts Metro for the dev client
```

- Requires a **development build** installed on the phone (Expo Go won't run the app — native modules).
- JS changes hot-reload; **new route files or native-dep changes need a Metro restart / new dev build** respectively.
- To exercise the prod API point `EXPO_PUBLIC_API_URL` at `https://api.cliphy.app`; for local server testing run `pnpm dev:server` and point at the machine's LAN address.

## Environment variables

Baked in at build/update time (not runtime):

| Var                                                          | Purpose                  |
| ------------------------------------------------------------ | ------------------------ |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase auth + Realtime |
| `EXPO_PUBLIC_API_URL`                                        | Cliphy REST API base     |

For EAS cloud builds these must be available to the build (eas.json `env`, EAS secrets, or `.env` committed-adjacent mechanisms) — a build with missing values warns at startup (`lib/supabase.ts`) and auth simply fails.

## EAS build profiles (`eas.json`)

| Profile       | What it's for             | Distribution                        | OTA channel   |
| ------------- | ------------------------- | ----------------------------------- | ------------- |
| `development` | Dev client for daily work | internal (ad-hoc)                   | `development` |
| `preview`     | Shareable test builds     | internal (ad-hoc)                   | `preview`     |
| `production`  | App Store / TestFlight    | store, `autoIncrement` build number | `production`  |

```bash
eas build --profile development --platform ios   # dev client
eas build --profile preview --platform ios       # ad-hoc test build
eas build --profile production --platform ios    # store build
```

- Apple: **paid developer account** ($99/yr) — no 7-day signing expiry on any profile.
- CNG workflow: `ios/`/`android/` are gitignored; EAS runs prebuild from `app.json` every build, so native config changes are just `app.json` edits.
- **`eas submit` is not yet configured** — `eas.json` `submit.production.ios` still has placeholders (`YOUR_APPLE_ID`, `YOUR_ASC_APP_ID`, `YOUR_TEAM_ID`). Fill with the real Apple ID, App Store Connect app id for **`com.cliphy.ios`**, and team id before first TestFlight submit.

## OTA updates (EAS Update) — configured 2026-06-09

JS-only changes ship over the air without a build:

```bash
eas update --channel production --message "fix: …"
# also: --channel preview / development
```

How it's wired:

- `app.json`: `updates.url = https://u.expo.dev/5af71f4e-…`, `runtimeVersion: { policy: "fingerprint" }`.
- Each build profile pins a **channel**; an update published to a channel reaches all builds on that channel **with a matching fingerprint**.
- **Fingerprint policy** = hash of the native project. JS-only change → same fingerprint → OTA applies. Native dep / plugin / app.json-native change → new fingerprint → old builds silently stop receiving updates and a **new build is required**. This is the safety mechanism, not a bug.
- **Bootstrapping**: OTA only works on binaries built _with_ `expo-updates` embedded (added 2026-06-09). The first build after that date is the entry fee; everything older is unreachable by OTA.
- Dev client ignores OTA entirely (updates disabled in dev).

### Decision guide: build or update?

| Change                                                                         | Ship via     |
| ------------------------------------------------------------------------------ | ------------ |
| TS/TSX/JS, styling, assets referenced from JS                                  | `eas update` |
| New/upgraded native dependency                                                 | `eas build`  |
| `app.json` plugin or native config (share-intent rules, icons, splash, scheme) | `eas build`  |
| Expo SDK upgrade                                                               | `eas build`  |

## Release flow (target state)

1. Merge to `main` (server deploys via Vercel automatically — mobile does **not** auto-deploy).
2. JS-only mobile change → `eas update --channel production`.
3. Native-affecting change → `eas build --profile production` → `eas submit` (once configured) → TestFlight → App Store review.
4. Sanity-check the share-sheet flow **from a cold launch** on every native build (see gotchas — it's the regression that hides from warm-app testing).

## History

- 2026-04-10 — initial app plan (`docs/superpowers/plans/2026-04-10-mobile-app.md`)
- 2026-06-09 — share triple-queue fix (client + server, ADR 0039), `+native-intent` cold-launch fix, swipe-back, EAS Update/OTA configured (Day 64 devlog)
