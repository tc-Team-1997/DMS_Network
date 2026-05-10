/**
 * MobileSidebar — off-canvas drawer variant of the sidebar for viewports < lg.
 *
 * Wraps the sidebar content in the CC4 Drawer (left side).
 * Auto-closes on nav item click via the onNavClick prop passed down to
 * the inner nav links.
 */

import { Link, useLocation } from 'react-router-dom';
import { FileText, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/store/auth';
import { useTenant } from '@/store/tenant';
import { canAccess, navItems, sections } from './nav';
import { cn } from '@/lib/cn';
import { Drawer } from '@/components/ui/Drawer';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
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

  const monogram =
    tenant.monogram ||
    (tenant.display_name ? tenant.display_name.slice(0, 2).toUpperCase() : 'DM');

  const productName = tenant.product_name ?? tenant.display_name ?? 'DocManager';

  const onLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="left"
      width="260px"
      title={undefined}
    >
      {/* Logo + tenant monogram */}
      <div className="px-2 pt-1 pb-4 -mx-5 -mt-5 bg-sidebar">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-blue flex items-center justify-center flex-shrink-0">
            <FileText size={16} className="text-white" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-[13px] font-semibold leading-tight">{productName}</p>
            <p className="text-sidebar-text text-[10px] leading-tight opacity-80">Document Platform</p>
          </div>
        </div>
        {tenant.display_name && (
          <div className="mt-3 flex items-center gap-1.5">
            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold leading-none">{monogram}</span>
            </div>
            <span className="text-sidebar-text text-[10px] leading-tight opacity-70 truncate">
              {tenant.display_name}
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 pt-2 -mx-5 px-2 bg-sidebar overflow-y-auto" aria-label="Main navigation">
        {sections.map((section, gi) => {
          const items = navItems.filter(
            (i) => i.section === section && canAccess(user.role, i.perm),
          );
          if (items.length === 0) return null;
          return (
            <div key={section} className={gi > 0 ? 'mt-3' : ''}>
              <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-sidebar-text opacity-60">
                {section}
              </p>
              {items.map(({ label, i18nKey, path, icon: Icon, comingSoon }) => {
                const active = path === '/' ? pathname === '/' : pathname.startsWith(path);
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={onClose}
                  >
                    <div
                      className={cn(
                        'h-11 mx-1 my-0.5 px-3 rounded-md flex items-center gap-2.5 transition-colors',
                        active
                          ? 'bg-brand-blue text-white font-semibold'
                          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white font-normal',
                      )}
                    >
                      <Icon size={15} strokeWidth={active ? 2.25 : 1.75} className="flex-shrink-0" />
                      <span className="text-[13px] leading-none flex-1">{i18nKey ? t(i18nKey, label) : label}</span>
                      {comingSoon && (
                        <span className="text-[8px] font-semibold opacity-60 tracking-wide">SOON</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="-mx-5 px-4 py-4 border-t border-white/10 bg-sidebar">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-brand-blue/30 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[12px] font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[13px] font-medium truncate">{user.full_name ?? user.username}</p>
            <p className="text-sidebar-text text-[11px] truncate opacity-80">{user.role}</p>
          </div>
          <button
            type="button"
            onClick={() => { void onLogout(); }}
            className="text-sidebar-text hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </Drawer>
  );
}
