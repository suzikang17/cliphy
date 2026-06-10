import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";

const PLATFORMS = ["web", "mobile", "extension"] as const;
type Platform = (typeof PLATFORMS)[number];

const MOBILE_SCHEME = "com.cliphy.app";

/**
 * Where to send the browser after the callback. Mobile gets a deep link
 * (caught by openAuthSessionAsync, which closes the in-app browser);
 * web and extension land on the web app's subscriptions page.
 */
function clientRedirect(platform: Platform, params: string): string {
  if (platform === "mobile") {
    return `${MOBILE_SCHEME}://subscriptions?${params}`;
  }
  const webAppUrl = process.env.WEB_APP_URL ?? "";
  return `${webAppUrl}/subscriptions?${params}`;
}

export const authGoogleRoutes = new Hono<AppEnv>();

// GET /status — check if Google account is connected
authGoogleRoutes.get("/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { data } = await supabase
    .from("user_google_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return c.json({ connected: !!data });
});

// GET / — initiate OAuth flow, returns the Google redirect URL as JSON.
// ?platform=web|mobile|extension controls where the callback redirects.
authGoogleRoutes.get("/", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const state = randomUUID();

  const platformParam = c.req.query("platform") ?? "web";
  const platform: Platform = (PLATFORMS as readonly string[]).includes(platformParam)
    ? (platformParam as Platform)
    : "web";

  await supabase.from("oauth_states").insert({ state, user_id: userId, platform });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return c.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /callback — exchange code for tokens (redirect from Google, no auth header)
authGoogleRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  // Resolve and consume the state first (single use, even on error paths) so
  // error redirects can target the platform that initiated the flow.
  let platform: Platform = "web";
  let stateRow: { user_id: string; expires_at: string } | null = null;
  if (state) {
    const { data } = await supabase
      .from("oauth_states")
      .select("user_id, expires_at, platform")
      .eq("state", state)
      .maybeSingle();

    if (data) {
      await supabase.from("oauth_states").delete().eq("state", state);
      if ((PLATFORMS as readonly string[]).includes(data.platform as string)) {
        platform = data.platform as Platform;
      }
      stateRow = { user_id: data.user_id as string, expires_at: data.expires_at as string };
    }
  }

  if (error || !code || !state) {
    return c.redirect(clientRedirect(platform, "google_error=true"));
  }

  if (!stateRow) {
    return c.redirect(clientRedirect(platform, "google_error=invalid_state"));
  }

  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    return c.redirect(clientRedirect(platform, "google_error=state_expired"));
  }

  const userId = stateRow.user_id;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.redirect(clientRedirect(platform, "google_error=token_exchange_failed"));
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from("user_google_tokens").upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    expires_at: expiresAt,
    scopes: tokens.scope ?? GOOGLE_SCOPES,
  });

  // Kick off playlist auto-discovery right away (also re-runs every poll cycle)
  try {
    await inngest.send({
      name: "subscription/discover.requested",
      data: { userId },
    });
  } catch {
    // Non-fatal: the next cron cycle will discover anyway
  }

  return c.redirect(clientRedirect(platform, "google_connected=true"));
});

// DELETE / — revoke token and disconnect Google account
authGoogleRoutes.delete("/", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data: tokenRow } = await supabase
    .from("user_google_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (tokenRow) {
    // Fire and forget — revocation failure shouldn't block disconnect
    fetch(`https://oauth2.googleapis.com/revoke?token=${tokenRow.access_token as string}`, {
      method: "POST",
    }).catch(() => {});
  }

  await supabase.from("user_google_tokens").delete().eq("user_id", userId);

  await supabase
    .from("subscriptions")
    .update({ is_active: false })
    .eq("user_id", userId)
    .in("type", ["watch_later", "liked"]);

  return c.json({ disconnected: true });
});
