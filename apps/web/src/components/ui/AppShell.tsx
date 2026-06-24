/**
 * AppShell — ZorDMS v4.2
 *
 * Renders:
 *   - Topbar  (brand · branch-selector · global-search · actions · user-pill)
 *   - Sidebar (grouped nav with RBAC filtering)
 *   - Main content area (children)
 *   - Sidebar footer with system status
 *
 * RBAC: nav items whose `permission` is not in user.permissions are hidden.
 */
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Globe, User, Camera, FileEdit, Cpu,
  Briefcase, Folder, FileText, Activity,
  Search, Eye, GitBranch, Shield, AlertTriangle,
  BarChart2, Link2, Lock, Settings, Bell, Upload, ChevronDown,
  Users,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext.js";

/* ─────────── nav schema ─────────── */
interface NavItem {
  label:       string;
  path:        string;
  icon:        ReactNode;
  badge?:      { count: number | string; cls: "nb-r" | "nb-g" | "nb-b" };
  permission?: string; // if set, item hidden when user lacks this permission
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Intelligence",
    items: [
      { label: "Executive Dashboard", path: "/dashboard",      icon: <LayoutDashboard size={15} />, permission: "dashboard:read" },
      { label: "Branch Network",      path: "/branch-network", icon: <Globe size={15} />,           badge: { count: 3, cls: "nb-r" }, permission: "branch:read" },
      { label: "Customer 360°",       path: "/customer360",    icon: <User size={15} />,            permission: "customer:read" },
    ],
  },
  {
    label: "Ingestion",
    items: [
      { label: "Multi-Channel Capture", path: "/capture",  icon: <Camera size={15} />,  permission: "document:capture" },
      { label: "Indexing & QA",          path: "/indexing", icon: <FileEdit size={15} />, badge: { count: 18, cls: "nb-r" }, permission: "document:index" },
      { label: "AI Engine",              path: "/ai-engine", icon: <Cpu size={15} />,     badge: { count: 342, cls: "nb-g" }, permission: "ai:read" },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Case Management",     path: "/case-management",     icon: <Briefcase size={15} />, badge: { count: 4, cls: "nb-b" }, permission: "case:read" },
      { label: "Repository",          path: "/repository",          icon: <Folder size={15} />,     permission: "document:read" },
      { label: "Records Management",  path: "/records-management",  icon: <FileText size={15} />,   permission: "records:read" },
      { label: "Document Lifecycle",  path: "/document-lifecycle",  icon: <Activity size={15} />,   permission: "lifecycle:read" },
    ],
  },
  {
    label: "Discovery",
    items: [
      { label: "Enterprise Search",  path: "/search",  icon: <Search size={15} />,     permission: "search:read" },
      { label: "Document Viewer",    path: "/viewer",  icon: <Eye size={15} />,         permission: "document:read" },
    ],
  },
  {
    label: "Process",
    items: [
      { label: "Workflow Engine",   path: "/workflow-engine",   icon: <GitBranch size={15} />, badge: { count: 6, cls: "nb-g" }, permission: "workflow:read" },
      { label: "Review Queue",      path: "/review-queue",      icon: <Shield size={15} />,    permission: "review:read" },
      { label: "Compliance & Audit",path: "/compliance-audit",  icon: <Shield size={15} />,    permission: "compliance:read" },
      { label: "Alerts & Events",   path: "/alerts",            icon: <AlertTriangle size={15} />, badge: { count: 11, cls: "nb-r" }, permission: "alerts:read" },
    ],
  },
  {
    label: "Analytics & Platform",
    items: [
      { label: "Integration Hub",       path: "/integration-hub",        icon: <Link2 size={15} />,    permission: "integration:read" },
      { label: "Security & RBAC",       path: "/security",               icon: <Lock size={15} />,     permission: "security:read" },
      { label: "User Management",       path: "/users",                  icon: <Users size={15} />,    permission: "user:read" },
      { label: "System Administration", path: "/system-administration",  icon: <Settings size={15} />, permission: "admin:read" },
    ],
  },
];

/* ─────────── component ─────────── */
export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function allowed(permission?: string) {
    if (!permission) return true;
    return user?.permissions?.includes(permission) ?? false;
  }

  /* initials from username */
  const initials = (user?.username ?? "?")
    .split(/[._\s-]/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── Topbar ── */}
      <header className="topbar">
        {/* Brand */}
        <div className="topbar-logo">
          <div className="topbar-gem" />
          <div className="topbar-brand">
            <b>ZorDMS</b>
            <small>Enterprise Document Platform v4.2</small>
          </div>
        </div>

        {/* Branch selector */}
        <button className="topbar-branch" type="button">
          <span className="status-dot dot-green dot-pulse" />
          <span>All Branches — HQ Cairo</span>
          <ChevronDown size={11} />
        </button>

        {/* Global search */}
        <div className="topbar-search">
          <input
            type="text"
            placeholder="Semantic AI search — customer, CID, document content, type…"
          />
          <span className="topbar-ai-tag">AI</span>
        </div>

        {/* Right actions */}
        <div className="topbar-actions">
          <button className="ic" type="button" title="Alerts (11)" onClick={() => navigate("/alerts")}>
            <Bell size={17} />
            <span className="notdot" />
          </button>

          <button className="ic" type="button" title="Compliance" onClick={() => navigate("/compliance-audit")}>
            <Shield size={17} />
          </button>

          <button className="upbtn" type="button" onClick={() => navigate("/capture")}>
            <Upload size={12} />
            Ingest Document
          </button>

          {/* User pill */}
          <button className="usr-pill" type="button" onClick={logout} title="Click to sign out">
            <span className="usr-av">{initials}</span>
            <span>
              <b>{user?.username ?? "User"}</b>
              <small>{user?.roles?.[0] ?? "Staff"}</small>
            </span>
          </button>
        </div>
      </header>

      {/* ── Body row ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <nav className="sidebar" aria-label="Main navigation">
          {NAV_GROUPS.map(group => {
            const visible = group.items.filter(i => allowed(i.permission));
            if (visible.length === 0) return null;
            return (
              <div key={group.label} className="nav-section">
                <div className="nav-label">{group.label}</div>
                {visible.map(item => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                  >
                    {item.icon}
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.badge && (
                      <span className={`nb ${item.badge.cls}`}>{item.badge.count}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}

          {/* Sidebar footer */}
          <div className="sidebar-footer">
            <div className="sys" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "var(--sil)" }}>
              <span className="status-dot dot-green dot-pulse" />
              All 18 services healthy
            </div>
            <div className="mono" style={{ fontSize: 9, color: "var(--sil)", marginTop: 5 }}>
              v4.2.1 · Build {new Date().getFullYear()}
            </div>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main className="main-content fade-up">
          {children}
        </main>
      </div>
    </div>
  );
}
