import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !user.permissions.includes(permission)) return <div style={{ padding: 40 }}>Not authorised.</div>;
  return <>{children}</>;
}
