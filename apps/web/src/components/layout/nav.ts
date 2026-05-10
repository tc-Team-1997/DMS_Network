import {
  LayoutDashboard,
  Camera,
  FilePenLine,
  FolderTree,
  Search,
  Eye,
  Workflow,
  Bell,
  BarChart3,
  ShieldCheck,
  Settings,
  ScrollText,
  Plug,
  Users,
  Sparkles,
  FileSliders,
  BookOpen,
  CopyX,
  Archive,
  ClipboardList,
  ShieldAlert,
  FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  /** Optional i18n key, falls back to label when no translation exists. */
  i18nKey?: string;
  path: string;
  icon: LucideIcon;
  section: 'Overview' | 'Operations' | 'Discovery' | 'Governance' | 'Platform';
  /** Permission code mirroring services/rbac.js */
  perm?: 'view' | 'capture' | 'index' | 'approve' | 'admin' | 'workflow';
  comingSoon?: boolean;
}

export const navItems: NavItem[] = [
  { label: 'Dashboard',      i18nKey: 'nav.dashboard',  path: '/',            icon: LayoutDashboard, section: 'Overview',   perm: 'view' },

  { label: 'Capture',        i18nKey: 'nav.capture',    path: '/capture',     icon: Camera,          section: 'Operations', perm: 'capture' },
  { label: 'Indexing',       i18nKey: 'nav.indexing',   path: '/indexing',    icon: FilePenLine,     section: 'Operations', perm: 'index' },
  { label: 'Repository',     i18nKey: 'nav.repository', path: '/repository',  icon: FolderTree,      section: 'Operations', perm: 'view' },
  { label: 'Workflows',      i18nKey: 'nav.workflows',  path: '/workflows',   icon: Workflow,        section: 'Operations', perm: 'workflow' },

  { label: 'Search',         i18nKey: 'nav.search',     path: '/search',      icon: Search,          section: 'Discovery',  perm: 'view' },
  { label: 'Viewer',         i18nKey: 'nav.viewer',     path: '/viewer',      icon: Eye,             section: 'Discovery',  perm: 'view' },
  { label: 'AI Engine',      i18nKey: 'nav.ai',         path: '/ai',          icon: Sparkles,        section: 'Discovery',  perm: 'view' },

  { label: 'Alerts',         i18nKey: 'nav.alerts',     path: '/alerts',      icon: Bell,            section: 'Governance', perm: 'view' },
  { label: 'Reports & BI',   i18nKey: 'nav.reports',    path: '/reports',     icon: BarChart3,       section: 'Governance', perm: 'view' },
  { label: 'Compliance',     i18nKey: 'nav.compliance', path: '/compliance',  icon: ScrollText,      section: 'Governance', perm: 'view' },
  { label: 'Audit Log',      i18nKey: 'nav.audit',      path: '/admin/audit', icon: ClipboardList,   section: 'Governance', perm: 'admin' },
  { label: 'DSAR',           path: '/admin/dsar',  icon: ShieldAlert,     section: 'Governance', perm: 'admin' },
  { label: 'Regulator Reports', path: '/regulator-reports', icon: FileSpreadsheet, section: 'Governance', perm: 'admin' },

  { label: 'Integration',    path: '/integration', icon: Plug,            section: 'Platform',   perm: 'view' },
  { label: 'Security & RBAC',path: '/security',    icon: ShieldCheck,     section: 'Platform',   perm: 'admin' },
  { label: 'Users',          path: '/users',       icon: Users,           section: 'Platform',   perm: 'admin' },
  { label: 'Document types', path: '/admin/document-types',  icon: FileSliders, section: 'Platform', perm: 'admin' },
  { label: 'Dedup settings', path: '/admin/dedup-settings',  icon: CopyX,       section: 'Platform', perm: 'admin' },
  { label: 'Retention & WORM', path: '/admin/retention',     icon: Archive,     section: 'Platform', perm: 'admin' },
  { label: 'AI glossary',    path: '/admin/ai-glossary',     icon: BookOpen,    section: 'Platform', perm: 'admin' },
  { label: 'System Admin',   i18nKey: 'nav.admin',           path: '/admin',                 icon: Settings,    section: 'Platform', perm: 'admin' },
];

export const sections: NavItem['section'][] = [
  'Overview',
  'Operations',
  'Discovery',
  'Governance',
  'Platform',
];

/** Permissions matrix mirrored from Node services/rbac.js. */
const permMatrix: Record<string, ReadonlyArray<NonNullable<NavItem['perm']>>> = {
  'Doc Admin': ['view', 'capture', 'index', 'approve', 'admin', 'workflow'],
  Maker:       ['view', 'capture', 'index', 'workflow'],
  Checker:     ['view', 'approve', 'workflow'],
  Viewer:      ['view'],
};

export function canAccess(role: string, perm: NavItem['perm']): boolean {
  if (!perm) return true;
  const allowed = permMatrix[role] ?? [];
  return allowed.includes(perm);
}
