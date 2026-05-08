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
  { label: 'Indexing',       path: '/indexing',    icon: FilePenLine,     section: 'Operations', perm: 'index' },
  { label: 'Repository',     path: '/repository',  icon: FolderTree,      section: 'Operations', perm: 'view' },
  { label: 'Workflows',      path: '/workflows',   icon: Workflow,        section: 'Operations', perm: 'workflow' },

  { label: 'Search',         path: '/search',      icon: Search,          section: 'Discovery',  perm: 'view' },
  { label: 'Viewer',         path: '/viewer',      icon: Eye,             section: 'Discovery',  perm: 'view' },
  { label: 'AI Engine',      path: '/ai',          icon: Sparkles,        section: 'Discovery',  perm: 'view' },

  { label: 'Alerts',         path: '/alerts',      icon: Bell,            section: 'Governance', perm: 'view' },
  { label: 'Reports & BI',   path: '/reports',     icon: BarChart3,       section: 'Governance', perm: 'view' },
  { label: 'Compliance',     path: '/compliance',  icon: ScrollText,      section: 'Governance', perm: 'view' },

  { label: 'Integration',    path: '/integration', icon: Plug,            section: 'Platform',   perm: 'view' },
  { label: 'Security & RBAC',path: '/security',    icon: ShieldCheck,     section: 'Platform',   perm: 'admin' },
  { label: 'Users',          path: '/users',       icon: Users,           section: 'Platform',   perm: 'admin' },
  { label: 'Document types', path: '/admin/document-types',  icon: FileSliders, section: 'Platform', perm: 'admin' },
  { label: 'Dedup settings', path: '/admin/dedup-settings',  icon: CopyX,       section: 'Platform', perm: 'admin' },
  { label: 'AI glossary',    path: '/admin/ai-glossary',     icon: BookOpen,    section: 'Platform', perm: 'admin' },
  { label: 'System Admin',   path: '/admin',                 icon: Settings,    section: 'Platform', perm: 'admin' },
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
