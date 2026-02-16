import { get, set, remove } from "./storage";

const TOKEN_KEY = "auth_token";

export async function getAuthToken(): Promise<string | null> {
  return get<string>(TOKEN_KEY);
}

export async function setAuthToken(token: string): Promise<void> {
  await set(TOKEN_KEY, token);
}

export async function clearAuthToken(): Promise<void> {
  await remove(TOKEN_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== null;
}
