import { useRef, useState } from 'react';
import { Bell, ChevronDown, Menu, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/store/auth';
import { useTenant, useAvailableTenants } from '@/store/tenant';
import { post } from '@/lib/http';
import { z } from 'zod';
import { Breadcrumbs } from './Breadcrumbs';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { Popover } from '@/components/ui/Popover';
import { NotificationFeed, useUnreadCount } from '@/modules/notifications/NotificationFeed';
import { useIsMobile } from '@/lib/useMatchMedia';
import { cn } from '@/lib/cn';
import { changeLocale, type Locale, SUPPORTED_LOCALES } from '@/lib/i18n';

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
    <div className="relative hidden md:block">
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
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-alt transition-colors disabled:opacity-50 min-h-[44px]"
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
  const { t } = useTranslation();
  const unread = useUnreadCount();

  return (
    <Popover
      trigger={
        <button
          type="button"
          data-testid="notif-bell"
          className="w-9 h-9 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border border-divider hover:bg-surface-alt transition-colors relative"
          aria-label={unread > 0
            ? t('notif.unread_count', { count: unread, defaultValue: '{{count}} unread' })
            : t('notif.title', 'Notifications')}
        >
          <Bell size={15} className="text-ink-sub" />
          {unread > 0 && (
            <span
              data-testid="notif-badge-count"
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full bg-danger text-white text-[10px] font-medium flex items-center justify-center px-1"
              aria-hidden="true"
            >
              {unread > 99 ? '99+' : unread}
            </span>
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
// LocaleSwitcher — EN / DZ pill toggle in Topbar
// ---------------------------------------------------------------------------

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  dz: 'DZ',
};

function LocaleSwitcher() {
  const { i18n } = useTranslation();
  const active = (SUPPORTED_LOCALES.includes(i18n.language as Locale)
    ? i18n.language
    : 'en') as Locale;

  return (
    <div
      role="group"
      aria-label="Language selector"
      className="hidden sm:flex items-center rounded-full border border-divider overflow-hidden h-8"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const isCurrent = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => { changeLocale(locale); }}
            aria-pressed={isCurrent}
            aria-label={`Switch to ${locale === 'en' ? 'English' : 'Dzongkha'}`}
            data-testid={`locale-btn-${locale}`}
            className={cn(
              'px-2.5 h-full text-[11px] font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:ring-inset',
              isCurrent
                ? 'bg-brand-blue text-white'
                : 'bg-white text-ink-sub hover:bg-surface-alt',
            )}
          >
            {LOCALE_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile search overlay
// ---------------------------------------------------------------------------

function MobileSearchOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider">
        <Search size={18} className="text-ink-sub flex-shrink-0" />
        <input
          type="search"
          autoFocus
          placeholder="Search documents…"
          className="flex-1 outline-none text-md text-ink bg-transparent placeholder:text-muted"
          aria-label="Search documents"
        />
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-sub hover:text-ink"
          aria-label="Close search"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-sm text-muted">
        Type to search across all documents
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

interface TopbarProps {
  /** Called when hamburger is tapped; only passed on mobile. */
  onMenuClick?: () => void;
  /** Whether the mobile drawer is open (for aria-expanded). */
  menuOpen?: boolean;
}

export function Topbar({ onMenuClick, menuOpen = false }: TopbarProps) {
  const user = useAuth((s) => s.user);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [searchOpen, setSearchOpen] = useState(false);

  const firstName = (user?.full_name ?? user?.username ?? 'User').split(' ')[0] ?? 'User';

  return (
    <>
      {searchOpen && isMobile && (
        <MobileSearchOverlay onClose={() => { setSearchOpen(false); }} />
      )}

      <header className="h-[58px] bg-white border-b border-divider flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger — mobile only */}
          {onMenuClick !== undefined && (
            <button
              type="button"
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              aria-controls="mobile-nav-drawer"
              aria-expanded={menuOpen}
              data-testid="mobile-hamburger"
              className={cn(
                'lg:hidden flex-shrink-0 flex items-center justify-center rounded-input',
                'min-h-[44px] min-w-[44px] text-ink-sub hover:text-ink hover:bg-surface-alt transition-colors',
              )}
            >
              <Menu size={20} />
            </button>
          )}

          <div className="min-w-0">
            <Breadcrumbs />
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <OfflineIndicator />

          {/* Search icon — mobile only, expands to overlay */}
          {isMobile && (
            <button
              type="button"
              onClick={() => { setSearchOpen(true); }}
              aria-label="Open search"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border border-divider hover:bg-surface-alt transition-colors"
            >
              <Search size={15} className="text-ink-sub" />
            </button>
          )}

          {/* Tenant chip — desktop only */}
          <TenantChip />

          {/* Locale switcher — EN / DZ toggle */}
          <LocaleSwitcher />

          {/* Branch + role chip — desktop only */}
          {user && (
            <span
              data-testid="topbar-branch-role-chip"
              className="hidden md:inline-flex items-center gap-1 rounded-full bg-brand-skyLight/40 text-brand-navy text-2xs px-2 py-0.5"
              title={`${user.branch ?? t('topbar.no_branch', 'HQ')} · ${user.role}`}
            >
              <span className="font-medium">{user.branch ?? t('topbar.no_branch', 'HQ')}</span>
              <span className="text-divider" aria-hidden="true">·</span>
              <span>{user.role}</span>
            </span>
          )}

          <BellButton />

          <div className="h-9 pl-1 pr-3 rounded-full bg-brand-skyLight flex items-center gap-2 min-h-[44px]">
            <div className="w-7 h-7 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[11px] font-semibold">
                {firstName[0]?.toUpperCase() ?? 'U'}
              </span>
            </div>
            <span className="text-xs font-medium text-brand-blue hidden sm:block">{firstName}</span>
          </div>
        </div>
      </header>
    </>
  );
}
