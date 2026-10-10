import { getAccessToken, getRefreshToken } from "./auth";

/** Open a cliphy.app page in a new tab, signed in as you (session passed in the hash). */
export async function openWebApp(path: string): Promise<void> {
  const base = (import.meta.env.VITE_WEB_URL as string) || "https://cliphy.app";
  const [accessToken, refreshToken] = await Promise.all([getAccessToken(), getRefreshToken()]);
  const hash =
    accessToken && refreshToken
      ? `#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`
      : "";
  await browser.tabs.create({ url: `${base}${path}${hash}` });
}
