import { Link } from "react-router";
import { useAuth } from "../lib/auth-context";

export function Nav() {
  const { user, signOut } = useAuth();

  return (
    <nav className="flex items-center justify-between py-4 mb-6 border-b-2 border-(--color-border-soft)">
      <Link to="/" className="flex items-center gap-2 no-underline text-(--color-text)">
        <img src="/logo.svg" alt="" width="32" height="32" className="rounded-lg" />
        <span className="text-lg font-bold tracking-tight">Cliphy</span>
      </Link>

      <div className="flex items-center gap-4">
        {user ? (
          <>
            <Link
              to="/dashboard"
              className="text-sm font-semibold text-(--color-text-secondary) hover:text-neon-600 no-underline transition-colors"
            >
              Dashboard
            </Link>
            <button
              onClick={() => signOut()}
              className="text-sm font-semibold text-(--color-text-faint) hover:text-(--color-text) bg-transparent border-0 cursor-pointer transition-colors"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="text-sm font-bold px-4 py-2 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down no-underline transition-all"
          >
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
