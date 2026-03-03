# Onboarding Flow Design

## Goal

Get new users to their first summary in <60 seconds from install. 3-step mental model: sign in, go to YouTube, queue a video.

## Design

### Pre-Sign-In Welcome Screen

Replaces the current sparse sign-in view in `App.tsx` (lines 450-468).

- Hero: "Cliphy" + tagline "YouTube summaries in seconds"
- 3 value props (single line each): Queue any video, AI summary in ~30s, Key points & timestamps
- Sign-in button (same `handleSignIn` logic)
- No skip needed — sign-in is required

### Post-Sign-In Walkthrough

Single screen shown after first sign-in, before the dashboard.

- Heading: "You're in!"
- Card: "Go to a YouTube video and click 'Add to Queue'. Cliphy will generate an AI summary in ~30 seconds."
- CTA: "Got it" button → sets `onboarding_completed = true` → shows dashboard

### State Management

- `onboarding_completed` stored in `browser.storage.local` via existing `storage.get`/`storage.set`
- New state in `App.tsx`: `showOnboarding: boolean` (checked after sign-in)
- New component: `Onboarding.tsx` — receives `onComplete` callback

### Flow

1. New user opens sidepanel → sees welcome screen (pre-sign-in)
2. Signs in → `init()` runs → checks `onboarding_completed` in storage
3. Not set → `showOnboarding = true` → renders `Onboarding` component
4. User clicks "Got it" → `storage.set("onboarding_completed", true)` → `showOnboarding = false` → dashboard
5. Subsequent opens → `onboarding_completed` is true → skip straight to dashboard

## Files to Modify

| File                                           | Change                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/extension/components/Onboarding.tsx`     | New component — post-sign-in single-step walkthrough                              |
| `apps/extension/entrypoints/sidepanel/App.tsx` | Replace sign-in view with welcome screen; add onboarding state + check after init |

## No New Dependencies

Pure React + existing storage helpers. Matches neobrutalist design system (neon green, shadow-brutal, etc.)
