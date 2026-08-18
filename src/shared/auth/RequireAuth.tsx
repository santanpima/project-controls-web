import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// 4.1.1.1.2 — "A single RequireAuth wrapper gates every route behind
// [auth] state — not role-based, since there's no in-app RBAC in this
// prototype (ADR-001); it's simply 'signed in' or redirected to /login."
// That framing predates this codebase's own real Theme 2 RBAC work — the
// wrapper itself still only gates on sign-in state here, exactly as
// specified; per-route/per-action permission enforcement already happens
// server-side (2.2.1.2.1) regardless of what this wrapper does or doesn't
// check, so nothing is silently less safe by keeping this simple.
export function RequireAuth(): JSX.Element {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-neutral-500">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
