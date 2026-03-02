const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const TOKEN_KEYS = {
  ACCESS: "cliphy_access_token",
  REFRESH: "cliphy_refresh_token",
} as const;

export async function getAccessToken(): Promise<string | null> {
  const result = await browser.storage.local.get(TOKEN_KEYS.ACCESS);
  return (result[TOKEN_KEYS.ACCESS] as string) ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const result = await browser.storage.local.get(TOKEN_KEYS.REFRESH);
  return (result[TOKEN_KEYS.REFRESH] as string) ?? null;
}

async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await browser.storage.local.set({
    [TOKEN_KEYS.ACCESS]: accessToken,
    [TOKEN_KEYS.REFRESH]: refreshToken,
  });
}

async function clearTokens(): Promise<void> {
  await browser.storage.local.remove([TOKEN_KEYS.ACCESS, TOKEN_KEYS.REFRESH]);
}

// ── PKCE helpers ──────────────────────────────────────────

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(digest);
}

function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64UrlEncode(bytes.buffer);
}

/**
 * Runs the Supabase Google OAuth flow via browser.identity with PKCE.
 * Must be called from the background script (launchWebAuthFlow requirement).
 */
export async function signIn(): Promise<void> {
  const redirectUrl = browser.identity.getRedirectURL();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectUrl);
  authUrl.searchParams.set("flow_type", "pkce");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error("Auth flow was cancelled");
  }

  // PKCE returns code in query params, not hash fragment
  const url = new URL(responseUrl);
  const returnedState = url.searchParams.get("state");
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch — possible CSRF attack");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("Missing authorization code in response");
  }

  // Exchange code for tokens
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(err.error_description || err.msg || "Token exchange failed");
  }

  const data = await tokenRes.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Missing tokens in token exchange response");
  }

  await setTokens(data.access_token, data.refresh_token);
}

export async function signOut(): Promise<void> {
  // Best-effort server-side token revocation
  try {
    const accessToken = await getAccessToken();
    if (accessToken) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      });
    }
  } catch {
    // Network errors are fine — we still clear local tokens
  }
  await clearTokens();
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

/** Check if a JWT is expired (or will expire within bufferSeconds). */
export function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    const exp = payload.exp as number;
    if (!exp) return true;
    return Date.now() >= (exp - bufferSeconds) * 1000;
  } catch {
    return true;
  }
}

/** Decode the user ID (sub claim) from a JWT without verification. */
export function getUserIdFromToken(token: string): string | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    await clearTokens();
    return null;
  }

  const data = await res.json();
  await setTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

export function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
