import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import type { ReactNode } from 'react';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  const loc = useLocation();

  useEffect(() => {
    if (status === 'unknown') void hydrate();
  }, [status, hydrate]);

  if (status === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center bg-page text-muted">
        Loading…
      </div>
    );
  }
  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <>{children}</>;
}
