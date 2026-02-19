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

/**
 * Runs the Supabase Google OAuth flow via browser.identity.
 * Must be called from the background script (launchWebAuthFlow requirement).
 */
export async function signIn(): Promise<void> {
  const redirectUrl = browser.identity.getRedirectURL();
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectUrl);

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error("Auth flow was cancelled");
  }

  const hash = new URL(responseUrl).hash.slice(1);
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    throw new Error("Missing auth tokens in response");
  }

  await setTokens(accessToken, refreshToken);
}

export async function signOut(): Promise<void> {
  await clearTokens();
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

export async function refreshAccessToken(): Promise<string | null> {
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
