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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  section: 'Overview' | 'Operations' | 'Discovery' | 'Governance' | 'Platform';
  /** Permission code mirroring services/rbac.js */
  perm?: 'view' | 'capture' | 'index' | 'approve' | 'admin' | 'workflow';
  comingSoon?: boolean;
}

export const navItems: NavItem[] = [
  { label: 'Dashboard',      path: '/',            icon: LayoutDashboard, section: 'Overview',   perm: 'view' },

  { label: 'Capture',        path: '/capture',     icon: Camera,          section: 'Operations', perm: 'capture' },
  { label: 'Indexing',       path: '/indexing',    icon: FilePenLine,     section: 'Operations', perm: 'index',  comingSoon: true },
  { label: 'Repository',     path: '/repository',  icon: FolderTree,      section: 'Operations', perm: 'view' },
  { label: 'Workflows',      path: '/workflows',   icon: Workflow,        section: 'Operations', perm: 'workflow', comingSoon: true },

  { label: 'Search',         path: '/search',      icon: Search,          section: 'Discovery',  perm: 'view' },
  { label: 'Viewer',         path: '/viewer',      icon: Eye,             section: 'Discovery',  perm: 'view' },
  { label: 'AI Engine',      path: '/ai',          icon: Sparkles,        section: 'Discovery',  perm: 'view',    comingSoon: true },

  { label: 'Alerts',         path: '/alerts',      icon: Bell,            section: 'Governance', perm: 'view' },
  { label: 'Reports & BI',   path: '/reports',     icon: BarChart3,       section: 'Governance', perm: 'view',    comingSoon: true },
  { label: 'Compliance',     path: '/compliance',  icon: ScrollText,      section: 'Governance', perm: 'view',    comingSoon: true },

  { label: 'Integration',    path: '/integration', icon: Plug,            section: 'Platform',   perm: 'view',    comingSoon: true },
  { label: 'Security & RBAC',path: '/security',    icon: ShieldCheck,     section: 'Platform',   perm: 'admin',   comingSoon: true },
  { label: 'Users',          path: '/users',       icon: Users,           section: 'Platform',   perm: 'admin',   comingSoon: true },
  { label: 'System Admin',   path: '/admin',       icon: Settings,        section: 'Platform',   perm: 'admin',   comingSoon: true },
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
