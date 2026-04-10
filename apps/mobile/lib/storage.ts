import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "cliphy_supabase_session";

export async function getStoredSession(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeSession(session: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, session);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
