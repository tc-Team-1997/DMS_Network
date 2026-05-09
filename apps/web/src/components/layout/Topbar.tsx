import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, ChevronDown } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useTenant, useAvailableTenants } from '@/store/tenant';
import { post } from '@/lib/http';
import { z } from 'zod';
import { navItems } from './nav';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { Popover } from '@/components/ui/Popover';
import { NotificationFeed, useUnreadCount } from '@/modules/notifications/NotificationFeed';

// ---------------------------------------------------------------------------
// Tenant chip + dropdown
// ---------------------------------------------------------------------------

const SwitchTenantResponseSchema = z.object({
  ok:        z.literal(true).optional(),
  error:     z.string().optional(),
  message:   z.string().optional(),
  tenant_id: z.string().optional(),
});

function TenantChip() {
  const tenant = useTenant();
  const available = useAvailableTenants();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  // Monogram: 2-char abbreviation.
  const monogram = tenant.monogram ||
    (tenant.display_name ? tenant.display_name.slice(0, 2).toUpperCase() : 'DM');

  // Don't render the chip until branding has resolved.
  if (!tenant.display_name) return null;

  const handleToggle = () => {
    setNotice(null);
    setOpen((v) => !v);
  };

  const handleSwitch = async (targetTenantId: string) => {
    if (switching) return;
    setSwitching(true);
    setNotice(null);
    try {
      const data = await post(
        '/spa/api/me/switch-tenant',
        { tenant_id: targetTenantId },
        SwitchTenantResponseSchema,
      );
      if (data.ok) {
        // Same tenant — no-op.
        setOpen(false);
      } else {
        setNotice(
          data.message ??
          'Switching tenants requires signing out and signing back in.',
        );
      }
    } catch {
      setNotice('Switching tenants within the same session is not yet supported. Sign out and sign in under the target tenant.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={chipRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Tenant: ${tenant.display_name}`}
        className="h-9 pl-2.5 pr-2 rounded-full bg-brand-skyLight flex items-center gap-1.5 hover:bg-[#d0e3fb] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
      >
        <div className="w-6 h-6 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0">
          <span className="text-white text-[9px] font-bold leading-none">{monogram}</span>
        </div>
        <span className="text-[11px] font-medium text-brand-blue max-w-[100px] truncate">
          {tenant.display_name}
        </span>
        <ChevronDown
          size={11}
          className={`text-brand-blue transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => { setOpen(false); setNotice(null); }}
          />
          <div
            role="listbox"
            aria-label="Available tenants"
            className="absolute right-0 top-11 z-20 w-64 rounded-card bg-white border border-divider shadow-card py-1"
          >
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Tenant
            </p>
            {available.map((t) => (
              <button
                key={t.tenant_id}
                role="option"
                aria-selected={t.tenant_id === tenant.tenant_id}
                type="button"
                disabled={switching}
                onClick={() => { void handleSwitch(t.tenant_id); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-alt transition-colors disabled:opacity-50"
              >
                <div className="w-6 h-6 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold leading-none">
                    {t.display_name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <span className="text-[12px] text-ink truncate">{t.display_name}</span>
                {t.tenant_id === tenant.tenant_id && (
                  <span className="ml-auto text-[9px] font-semibold text-brand-sky uppercase tracking-wide">
                    Active
                  </span>
                )}
              </button>
            ))}
            {notice && (
              <p className="px-3 py-2 text-[11px] text-warning border-t border-divider">
                {notice}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BellButton — bell icon + unread badge + notification popover
// ---------------------------------------------------------------------------

function BellButton() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();

  return (
    <Popover
      trigger={
        <button
          type="button"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-divider hover:bg-surface-alt transition-colors relative"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        >
          <Bell size={15} className="text-ink-sub" />
          {unread > 0 && (
            <span
              className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger rounded-full"
              aria-hidden="true"
            />
          )}
        </button>
      }
      open={open}
      onClose={() => { setOpen(false); }}
      placement="bottom"
    >
      <NotificationFeed />
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

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
        <OfflineIndicator />

        {/* Tenant chip — shows once the tenant branding resolves */}
        <TenantChip />

        <BellButton />

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
