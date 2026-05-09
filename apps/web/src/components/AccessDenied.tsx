import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

/**
 * Generic access-denied screen.
 * Rendered by SettingsLayout (and any future gated area) when the logged-in
 * user does not hold the required role.
 * Banking-grade copy: neutral, non-blaming, actionable.
 */
export function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider">
        <ShieldOff size={24} className="text-muted" />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <p className="text-lg font-semibold text-ink">Access restricted</p>
        <p className="text-sm text-muted">
          You don&apos;t have access to this area. Contact your tenant administrator
          if you believe this is a mistake.
        </p>
      </div>
      <Link
        to="/"
        className="mt-2 inline-flex items-center rounded-input bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 transition-colors"
      >
        Return to home
      </Link>
    </div>
  );
}
