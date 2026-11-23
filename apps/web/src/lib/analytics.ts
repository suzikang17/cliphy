import posthog from "posthog-js";
import { POSTHOG_KEY } from "@cliphy/shared";

// Product analytics (PostHog, ADR 0073): where visitors come from, which pages
// they see, and recordings of sessions, so we can see where new people stop.
// A signed-in person is known by their account id only, never their email.

let on = false;

/** Class for the signed-in pages: their text is hidden in recordings and their clicks are not described. */
export const PRIVATE = "ph-mask ph-no-capture";

export function initAnalytics(): void {
  // The real site only: not local runs, not preview builds.
  if (!import.meta.env.PROD || !/(^|\.)cliphy\.app$/.test(window.location.hostname)) return;
  posthog.init(POSTHOG_KEY, {
    // Through our own address (routes in scripts/build-vercel.sh), so ad
    // blockers that drop requests to posthog.com do not hide visitors.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: true,
    // No profile for a visitor until they sign in.
    person_profiles: "identified_only",
    persistence: "localStorage",
    // Nothing is sent or stored until the visitor chooses (ConsentBanner).
    // Allow: full analytics. Decline: the visit is still counted, by an
    // anonymous id worked out on PostHog's side, with nothing stored here and
    // no recording.
    cookieless_mode: "on_reject",
    session_recording: {
      // Nothing typed is recorded, and no text inside the signed-in pages
      // (titles, summaries, notes). The layout and clicks still are.
      maskAllInputs: true,
      maskTextSelector: ".ph-mask",
      // `ph-no-capture` keeps clicks inside those pages from being described;
      // it must not also blank them out of the recording.
      blockClass: "ph-block",
    },
  });
  on = true;
}

export type Consent = "granted" | "denied" | "pending" | "off";

/** What the visitor has chosen. "off": analytics is not running here at all. */
export function consentStatus(): Consent {
  return on ? posthog.get_explicit_consent_status() : "off";
}

let accountId: string | null = null;

export function allowAnalytics(): void {
  if (!on) return;
  posthog.opt_in_capturing();
  if (accountId) identifyUser(accountId);
}

export function declineAnalytics(): void {
  if (on) posthog.opt_out_capturing();
}

/**
 * Tie this browser's visit to the account, so it joins the server's events
 * for that account. Only for a visitor who allowed analytics.
 */
export function identifyUser(userId: string): void {
  accountId = userId;
  if (!on || consentStatus() !== "granted") return;
  if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
}

export function resetUser(): void {
  accountId = null;
  if (on && consentStatus() === "granted") posthog.reset();
}
