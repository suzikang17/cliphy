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
      <div style={{ padding: "16px", textAlign: "center" }}>
        <p style={{ color: "#666" }}>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: "16px" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>Cliphy</h1>
        <p style={{ color: "#666", marginTop: "8px" }}>
          Queue YouTube videos and get AI-powered summaries.
        </p>
        <button
          onClick={handleSignIn}
          style={{
            marginTop: "16px",
            padding: "10px 20px",
            fontSize: "14px",
            backgroundColor: "#4285f4",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Sign in with Google
        </button>
        {error && <p style={{ color: "#d93025", fontSize: "12px", marginTop: "8px" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px" }}>
      <h1 style={{ fontSize: "20px", margin: 0 }}>Cliphy</h1>
      <div
        style={{
          marginTop: "12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: "14px" }}>{user.email}</p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "12px",
              color: "#666",
              textTransform: "capitalize",
            }}
          >
            {user.plan} plan
          </p>
        </div>
        <button
          onClick={handleSignOut}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            backgroundColor: "transparent",
            color: "#666",
            border: "1px solid #ddd",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
