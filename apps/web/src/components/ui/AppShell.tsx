/**
 * AppShell — ZorDMS
 *
 * Topbar: login-style brand · breadcrumb · branch scope (user) · alerts · user · exit
 * Sidebar: navy, grouped nav (RBAC-filtered), footer = version + build
 */
import type { ReactNode } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, User, Camera, FileEdit, Cpu,
  Briefcase, Folder, FileText, Activity,
  Search, Eye, GitBranch, Shield, AlertTriangle,
  Link2, Lock, Settings, Bell, ChevronDown, ChevronRight, MapPin, LogOut,
  Users,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext.js";
import { Tooltip } from "./Tooltip.js";

/* ─────────── nav schema ─────────── */
interface NavItem {
  label:       string;
  path:        string;
  icon:        ReactNode;
  permission?: string;
}
interface NavGroup { label: string; items: NavItem[]; }

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Intelligence",
    items: [
      { label: "Dashboard",           path: "/dashboard",   icon: <LayoutDashboard size={15} />, permission: "dashboard:read" },
      { label: "Customer 360°",       path: "/customer360", icon: <User size={15} />,            permission: "customer:read" },
    ],
  },
  {
    label: "Ingestion",
    items: [
      { label: "Capture",       path: "/capture",   icon: <Camera size={15} />,   permission: "document:capture" },
      { label: "Indexing & QA", path: "/indexing",  icon: <FileEdit size={15} />, permission: "document:index" },
      { label: "AI Engine",     path: "/ai-engine", icon: <Cpu size={15} />,      permission: "ai:read" },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Case Management",    path: "/case-management",    icon: <Briefcase size={15} />, permission: "case:read" },
      { label: "Repository",         path: "/repository",         icon: <Folder size={15} />,    permission: "document:read" },
      { label: "Records Management", path: "/records-management", icon: <FileText size={15} />,  permission: "records:read" },
      { label: "Document Lifecycle", path: "/document-lifecycle", icon: <Activity size={15} />,  permission: "lifecycle:read" },
    ],
  },
  {
    label: "Discovery",
    items: [
      { label: "Enterprise Search", path: "/search", icon: <Search size={15} />, permission: "search:read" },
      { label: "Document Viewer",   path: "/viewer", icon: <Eye size={15} />,    permission: "document:read" },
    ],
  },
  {
    label: "Process",
    items: [
      { label: "Workflow Engine",    path: "/workflow-engine",  icon: <GitBranch size={15} />,     permission: "workflow:read" },
      { label: "Review Queue",       path: "/review-queue",     icon: <Shield size={15} />,        permission: "review:read" },
      { label: "Compliance & Audit", path: "/compliance-audit", icon: <Shield size={15} />,        permission: "compliance:read" },
      { label: "Alerts & Events",    path: "/alerts",           icon: <AlertTriangle size={15} />, permission: "alerts:read" },
    ],
  },
  {
    label: "Analytics & Platform",
    items: [
      { label: "Integration Hub",       path: "/integration-hub",       icon: <Link2 size={15} />,    permission: "integration:read" },
      { label: "Security & RBAC",       path: "/security",              icon: <Lock size={15} />,     permission: "security:read" },
      { label: "User Management",       path: "/users",                 icon: <Users size={15} />,    permission: "user:read" },
      { label: "System Administration", path: "/system-administration", icon: <Settings size={15} />, permission: "admin:read" },
    ],
  },
];

/* flat path → {group,label} for the breadcrumb */
const PATH_INDEX: Record<string, { group: string; label: string }> = {};
for (const g of NAV_GROUPS) for (const it of g.items) PATH_INDEX[it.path] = { group: g.label, label: it.label };

/* Optional one-line subtitle under each section title. */
const SECTION_SUBTITLES: Record<string, string> = {
  "/customer360":          "Unified customer profile, documents and risk across all branches",
  "/capture":              "Multi-channel ingestion · OCR · AI classification",
  "/indexing":             "Index, validate and quality-check captured documents",
  "/ai-engine":            "Ask the document copilot · OCR · NLP classification",
  "/case-management":      "Cases, linked documents and collaborative review",
  "/repository":           "Hierarchical cabinets · version control · secure archival",
  "/records-management":   "Retention schedules, legal holds and disposition",
  "/document-lifecycle":   "Capture → review → approve → archive → dispose",
  "/search":               "Full-text, boolean, fuzzy & semantic AI search",
  "/viewer":               "Annotation · redaction · e-signature · stamp · versions",
  "/workflow-engine":      "Configurable maker–checker approval chains",
  "/review-queue":         "Human-in-the-loop review and approval queue",
  "/compliance-audit":     "Immutable audit trail and compliance reporting",
  "/alerts":               "Real-time compliance alerts and expiry notifications",
  "/integration-hub":      "Connectors, webhooks and external system sync",
  "/security":             "Roles, permissions and access control",
  "/users":                "User accounts, roles and provisioning",
  "/system-administration":"Service health, backups, dedup and document types",
  "/branch-network":       "Branch performance and document distribution",
};

/** "admin" → "Admin", "dorji.wangchuk" → "Dorji Wangchuk" */
function properCase(s: string): string {
  return s
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface AppShellProps { children: ReactNode; }

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function allowed(permission?: string) {
    if (!permission) return true;
    return user?.permissions?.includes(permission) ?? false;
  }

  const crumb = PATH_INDEX[location.pathname];
  const displayName = properCase(user?.username ?? "User");
  const role = user?.roles?.[0] ?? "Staff";
  const initials = displayName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const branchLabel = user?.branch ?? "All Branches";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── Topbar ── */}
      <header className="topbar">
        {/* Brand (matches login) */}
        <div className="topbar-logo">
          <div className="topbar-zbadge">Z</div>
          <div className="topbar-brand">
            <b>ZorDMS</b>
          </div>
        </div>

        {/* Breadcrumb */}
        {crumb && (
          <div className="topbar-breadcrumb">
            <span>{crumb.group}</span>
            <ChevronRight size={13} style={{ opacity: 0.5 }} />
            <b>{crumb.label}</b>
          </div>
        )}

        {/* Branch scope — based on the logged-in user (left) */}
        <Tooltip label="Branch scope" placement="bottom">
          <button className="topbar-branch" type="button" aria-label="Branch scope">
            <MapPin size={12} />
            <span>{branchLabel}</span>
            <ChevronDown size={11} />
          </button>
        </Tooltip>

        {/* Right actions */}
        <div className="topbar-actions">
          <Tooltip label="Alerts &amp; Events" placement="bottom">
            <button className="ic" type="button" aria-label="Alerts & Events" onClick={() => navigate("/alerts")}>
              <Bell size={17} />
              <span className="notdot" />
            </button>
          </Tooltip>

          <Tooltip label="Compliance &amp; Audit" placement="bottom">
            <button className="ic" type="button" aria-label="Compliance & Audit" onClick={() => navigate("/compliance-audit")}>
              <Shield size={17} />
            </button>
          </Tooltip>

          {/* User identity — plain text, same line, no button/pill chrome */}
          <div className="usr-identity" aria-label={`${displayName}, ${role}`}>
            <span className="usr-av">{initials}</span>
            <span className="usr-name-role">
              <b>{displayName}</b>
              <span className="usr-dot" aria-hidden="true"> · </span>
              <span className="usr-role">{role}</span>
            </span>
          </div>

          {/* Logout — separate exit button */}
          <Tooltip label="Sign out" placement="bottom">
            <button className="ic exit-ic" type="button" aria-label="Sign out" onClick={logout}>
              <LogOut size={17} />
            </button>
          </Tooltip>
        </div>
      </header>

      {/* ── Body row ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <nav className="sidebar" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter((i) => allowed(i.permission));
            if (visible.length === 0) return null;
            return (
              <div key={group.label} className="nav-section">
                <div className="nav-label">{group.label}</div>
                {visible.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                  >
                    {item.icon}
                    <span style={{ flex: 1 }}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}

          {/* Sidebar footer — version + build only */}
          <div className="sidebar-footer">
            <div className="mono" style={{ fontSize: 9 }}>
              v{__APP_VERSION__} · Build {new Date().getFullYear()}
            </div>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main className="main-content fade-up">
          {/* Section title — shown on every screen EXCEPT the Executive
              Dashboard (which has its own KPI hero). Uses the nav label so it
              stays in sync with the sidebar / breadcrumb. */}
          {crumb && location.pathname !== "/dashboard" && (
            <div className="section-title">
              <h1>{crumb.label}</h1>
              {SECTION_SUBTITLES[location.pathname] && (
                <p>{SECTION_SUBTITLES[location.pathname]}</p>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
