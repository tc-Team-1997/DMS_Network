import { Link, useLocation } from 'react-router-dom';
import { FileText, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/store/auth';
import { useTenant } from '@/store/tenant';
import { canAccess, navItems, sections } from './nav';
import { cn } from '@/lib/cn';

export function Sidebar() {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const tenant = useTenant();
  const { t } = useTranslation();

  if (!user) return null;

  const initials =
    (user.full_name ?? user.username ?? 'U')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  // Tenant monogram: use loaded value, fall back to first two chars of display_name.
  const monogram = tenant.monogram ||
    (tenant.display_name ? tenant.display_name.slice(0, 2).toUpperCase() : 'DM');

  // product_name: from branding namespace (merged into tenant on /me), or display_name,
  // or a static fallback that will never appear once the tenant has resolved.
  const productName = tenant.product_name ?? tenant.display_name ?? 'DocManager';

  const onLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <aside className="w-[220px] h-screen bg-sidebar flex flex-col flex-shrink-0">
      {/* Logo + tenant monogram */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-blue flex items-center justify-center flex-shrink-0">
            <FileText size={16} className="text-white" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-[13px] font-semibold leading-tight">{productName}</p>
            <p className="text-sidebar-text text-[10px] leading-tight opacity-80">Document Platform</p>
          </div>
        </div>
        {/* Tenant monogram chip — only render once branding has resolved */}
        {tenant.display_name && (
          <div className="mt-3 flex items-center gap-1.5">
            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold leading-none">{monogram}</span>
            </div>
            <span className="text-sidebar-text text-[10px] leading-tight opacity-90 truncate">
              {tenant.display_name}
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 pt-2 overflow-y-auto">
        {sections.map((section, gi) => {
          const items = navItems.filter(
            (i) => i.section === section && canAccess(user.role, i.perm),
          );
          if (items.length === 0) return null;
          return (
            <div key={section} className={gi > 0 ? 'mt-3' : ''}>
              <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-sidebar-text opacity-80">
                {section}
              </p>
              {items.map(({ label, i18nKey, path, icon: Icon, comingSoon }) => {
                const active = path === '/' ? pathname === '/' : pathname.startsWith(path);
                return (
                  <Link
                    key={path}
                    to={path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'h-7 mx-1 my-0.5 px-3 rounded-md flex items-center gap-2.5 transition-colors',
                      active
                        ? 'bg-brand-blue text-white font-semibold'
                        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white font-normal',
                    )}
                  >
                    <Icon size={13} strokeWidth={active ? 2.25 : 1.75} className="flex-shrink-0" />
                    <span className="text-[12px] leading-none flex-1">{i18nKey ? t(i18nKey, label) : label}</span>
                    {comingSoon && (
                      <span className="text-[8px] font-semibold opacity-60 tracking-wide">SOON</span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-blue/30 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[12px] font-medium truncate">{user.full_name ?? user.username}</p>
            <p className="text-sidebar-text text-[10px] truncate opacity-80">{user.role}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="text-sidebar-text hover:text-white transition-colors"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
