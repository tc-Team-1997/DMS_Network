/**
 * SettingsLayout — left-rail admin settings shell (CC3).
 *
 * RBAC gate at layout level: non-Doc-Admin roles see AccessDenied.
 * Left rail groups:
 *   Branding & Tenants   — Branding, Locales, Tenants
 *   Operational          — Capture, OCR, DocTypes, Workflows, AML, Retention
 *   Access & Security    — Users & Auth, RBAC, ABAC, Audit
 *   Platform             — Integrations, Notifications, Mobile
 */

import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  Palette,
  Globe2,
  Building2,
  Camera,
  ScanLine,
  FileType2,
  Workflow,
  GitBranch,
  Shield,
  Archive,
  ClipboardList,
  Bell,
  Smartphone,
  Plug,
  Lock,
  ShieldCheck,
  Search,
  UserCog,
  ShieldAlert,
  Sparkles,
  FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { AccessDenied } from '@/components/AccessDenied';

// ---------------------------------------------------------------------------
// Nav structure
// ---------------------------------------------------------------------------

interface NavEntry {
  label: string;
  path: string;
  icon: LucideIcon;
}

interface NavGroup {
  group: string;
  items: NavEntry[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Branding & Tenants',
    items: [
      { label: 'Branding',  path: '/admin/settings/branding',  icon: Palette  },
      { label: 'Locales',   path: '/admin/settings/locales',   icon: Globe2   },
      { label: 'Tenants',   path: '/admin/settings/tenants',   icon: Building2 },
    ],
  },
  {
    group: 'Operational',
    items: [
      { label: 'Capture',   path: '/admin/settings/capture',   icon: Camera    },
      { label: 'OCR',       path: '/admin/settings/ocr',       icon: ScanLine  },
      { label: 'Doc Types', path: '/admin/settings/doctypes',  icon: FileType2 },
      { label: 'Workflows',           path: '/admin/settings/workflows',           icon: Workflow   },
      { label: 'Workflow Templates', path: '/admin/settings/workflow-templates', icon: GitBranch  },
      { label: 'Search',             path: '/admin/settings/search',             icon: Search     },
      { label: 'AML',       path: '/admin/settings/aml',       icon: Shield    },
      { label: 'Retention', path: '/admin/settings/retention', icon: Archive   },
      { label: 'DocBrain',  path: '/admin/settings/docbrain',  icon: Sparkles  },
    ],
  },
  {
    group: 'Access & Security',
    items: [
      { label: 'Users & Auth', path: '/admin/settings/users-auth', icon: UserCog    },
      { label: 'RBAC',         path: '/admin/settings/rbac',       icon: Lock       },
      { label: 'ABAC',         path: '/admin/settings/abac',       icon: ShieldCheck },
      { label: 'Audit',        path: '/admin/settings/audit',      icon: ClipboardList },
    ],
  },
  {
    group: 'Platform',
    items: [
      { label: 'Integrations',  path: '/admin/settings/integrations',  icon: Plug       },
      { label: 'Notifications', path: '/admin/settings/notifications', icon: Bell       },
      { label: 'Mobile',        path: '/admin/settings/mobile',        icon: Smartphone },
    ],
  },
  {
    group: 'Compliance & Privacy',
    items: [
      { label: 'DSAR',             path: '/admin/settings/dsar',             icon: ShieldAlert     },
      { label: 'Regulator Reports', path: '/admin/settings/regulator-reports', icon: FileSpreadsheet },
    ],
  },
];

// ---------------------------------------------------------------------------
// Breadcrumb helpers
// ---------------------------------------------------------------------------

function crumbLabel(pathname: string): string {
  const last = pathname.split('/').pop() ?? '';
  const found = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.path === pathname);
  return found?.label ?? (last.charAt(0).toUpperCase() + last.slice(1));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsLayout() {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);

  // RBAC gate.
  if (!user || user.role !== 'Doc Admin') {
    return <AccessDenied />;
  }

  const activeLabel = crumbLabel(pathname);

  return (
    <div className="flex h-full gap-0">
      {/* Left rail */}
      <aside className="w-52 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto">
        <div className="px-3 py-4 space-y-4">
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group}>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {group}
              </p>
              {items.map(({ label, path, icon: Icon }) => {
                const active = pathname === path;
                return (
                  <Link key={path} to={path}>
                    <div
                      className={cn(
                        'flex items-center gap-2.5 rounded-input px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-brand-skyLight text-brand-blue font-semibold'
                          : 'text-ink-sub hover:bg-divider hover:text-ink',
                      )}
                    >
                      <Icon size={13} strokeWidth={active ? 2.25 : 1.75} className="flex-shrink-0" />
                      {label}
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Main panel */}
      <div className="flex-1 overflow-y-auto">
        {/* Sticky breadcrumb */}
        <div className="sticky top-0 z-10 border-b border-divider bg-surface px-6 py-3">
          <p className="text-xs text-muted">
            <span className="font-medium text-ink">Admin</span>
            <span className="mx-1.5 text-border">·</span>
            <span className="font-medium text-ink">Settings</span>
            <span className="mx-1.5 text-border">·</span>
            <span className="text-brand-blue">{activeLabel}</span>
          </p>
        </div>

        {/* Panel content */}
        <div className="px-8 py-6 max-w-2xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
