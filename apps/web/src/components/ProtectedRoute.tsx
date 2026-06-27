import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { NotAuthorised } from "./NotAuthorised.js";

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, sessionExpired } = useAuth();
  // Session expired mid-flow → DO NOT navigate to /login. Hold the route (a
  // neutral placeholder under the global SessionExpiredScreen overlay) so the
  // URL is preserved and the user re-authenticates back to where they were,
  // without unmounting/crashing a child page that assumes a live user.
  if (sessionExpired) return <div style={{ height: "100%" }} aria-hidden="true" />;
  // Not signed in (fresh/forced visit, no live session) → login.
  if (!user) return <Navigate to="/login" replace />;
  // Signed in but lacks the permission for this screen → branded 403.
  if (permission && !user.permissions.includes(permission)) {
    return <NotAuthorised variant="forbidden" />;
  }
  return <>{children}</>;
}
