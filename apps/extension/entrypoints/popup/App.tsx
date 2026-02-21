import { useEffect, useState } from "react";
import { getAccessToken, isAuthenticated } from "../../lib/auth";

interface UserInfo {
  email: string;
  plan: string;
}

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const authed = await isAuthenticated();
      if (authed) {
        const token = await getAccessToken();
        if (token) {
          await fetchUser(token);
        }
      }
    } catch {
      // Not authenticated, show sign-in
    } finally {
      setLoading(false);
    }
  }

  async function fetchUser(token: string) {
    const apiUrl = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUser({ email: data.user.email, plan: data.user.plan });
    }
  }

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const response = (await browser.runtime.sendMessage({ type: "SIGN_IN" })) as {
      success: boolean;
      error?: string;
    };
    if (response?.success) {
      await checkAuth();
    } else {
      setError(response?.error ?? "Sign in failed");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await browser.runtime.sendMessage({ type: "SIGN_OUT" });
    setUser(null);
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-4">
        <h1 className="text-xl m-0 font-semibold">Cliphy</h1>
        <p className="text-gray-500 mt-2">Queue YouTube videos and get AI-powered summaries.</p>
        <button
          onClick={handleSignIn}
          className="mt-4 px-5 py-2.5 text-sm bg-blue-600 text-white border-none rounded cursor-pointer w-full hover:bg-blue-700"
        >
          Sign in with Google
        </button>
        {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl m-0 font-semibold">Cliphy</h1>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-xs bg-transparent text-gray-500 border border-gray-300 rounded cursor-pointer hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">{user.email}</p>
    </div>
  );
}
