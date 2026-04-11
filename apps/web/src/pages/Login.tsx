import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { Nav } from "../components/Nav";

export function Login() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6">
      <Nav />
      <div className="max-w-sm mx-auto mt-12">
        <h1 className="text-2xl font-bold tracking-tight text-center mb-6">
          {mode === "signin" ? "Sign in to Cliphy" : "Create your account"}
        </h1>

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-xl shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer font-semibold text-sm transition-all mb-6"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
              fill="#34A853"
            />
            <path
              d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-(--color-border-soft)" />
          <span className="text-xs font-bold text-(--color-text-faint) uppercase">or</span>
          <div className="flex-1 h-px bg-(--color-border-soft)" />
        </div>

        {/* Email/Password */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-semibold mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border-2 border-(--color-border-hard) rounded-lg bg-(--color-surface) text-(--color-text) outline-none focus:border-neon-500 transition-colors"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2.5 text-sm border-2 border-(--color-border-hard) rounded-lg bg-(--color-surface) text-(--color-text) outline-none focus:border-neon-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-(--color-error-surface) border border-red-300 rounded-lg px-3 py-2 m-0">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 text-sm font-bold bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-xl shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50"
          >
            {submitting ? "Loading..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-(--color-text-muted) mt-6">
          {mode === "signin" ? (
            <>
              Don't have an account?{" "}
              <button
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="text-neon-600 font-semibold bg-transparent border-0 cursor-pointer hover:underline p-0"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="text-neon-600 font-semibold bg-transparent border-0 cursor-pointer hover:underline p-0"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
