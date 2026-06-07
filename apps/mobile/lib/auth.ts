import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

const redirectUri = AuthSession.makeRedirectUri({
  scheme: "com.cliphy.app",
  path: "auth/callback",
});

const resetRedirectUri = AuthSession.makeRedirectUri({
  scheme: "com.cliphy.app",
  path: "reset",
});

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUri,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

  if (result.type !== "success") {
    throw new Error("OAuth cancelled");
  }

  // Supabase v2 uses PKCE — exchange the authorization code for a session.
  // exchangeCodeForSession expects the bare code, not the full callback URL.
  const code = new URL(result.url).searchParams.get("code");
  if (!code) {
    throw new Error("Missing authorization code in OAuth callback");
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (sessionError) throw sessionError;

  return sessionData;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: resetRedirectUri,
  });
  if (error) throw error;
}

export async function exchangeRecoveryCode(code: string) {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
