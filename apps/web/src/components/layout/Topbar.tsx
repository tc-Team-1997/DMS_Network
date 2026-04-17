import { useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { navItems } from './nav';

export function Topbar() {
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();

  // Find the longest prefix match so /viewer/123 matches the "/viewer" nav item.
  const active =
    navItems
      .filter((n) => (n.path === '/' ? pathname === '/' : pathname.startsWith(n.path)))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? navItems[0];

  const title = active?.label ?? 'Dashboard';
  const module = active?.section ?? 'Overview';

  const firstName = (user?.full_name ?? user?.username ?? 'User').split(' ')[0] ?? 'User';

  return (
    <header className="h-[58px] bg-white border-b border-divider flex items-center justify-between px-8 flex-shrink-0">
      <div className="min-w-0">
        <p className="module-label">{module}</p>
        <h1 className="text-base font-semibold text-ink leading-tight mt-0.5">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-divider hover:bg-surface-alt transition-colors relative"
          aria-label="Notifications"
        >
          <Bell size={15} className="text-ink-sub" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-danger rounded-full" />
        </button>

        <div className="h-9 pl-1 pr-4 rounded-full bg-brand-skyLight flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-blue flex items-center justify-center">
            <span className="text-white text-[11px] font-semibold">
              {firstName[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <span className="text-xs font-medium text-brand-blue">{firstName}</span>
        </div>
      </div>
    </header>
  );
}
