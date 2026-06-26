import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { NotAuthorised } from "./NotAuthorised.js";

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user } = useAuth();
  // Not signed in → login. (An expired session is handled globally by the
  // SessionExpiredScreen; here `user` is simply null on a fresh/forced visit.)
  if (!user) return <Navigate to="/login" replace />;
  // Signed in but lacks the permission for this screen → branded 403.
  if (permission && !user.permissions.includes(permission)) {
    return <NotAuthorised variant="forbidden" />;
  }
  return <>{children}</>;
}
