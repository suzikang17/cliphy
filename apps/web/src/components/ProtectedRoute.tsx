import { Navigate, Outlet } from "react-router";
import { useAuth } from "../lib/auth-context";
import { PRIVATE } from "../lib/analytics";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Everything a signed-in person sees here is theirs: kept out of analytics.
  return (
    <div className={PRIVATE}>
      <Outlet />
    </div>
  );
}
