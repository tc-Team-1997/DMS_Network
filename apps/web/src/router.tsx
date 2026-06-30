/**
 * ZorDMS v4.2 Router
 *
 * All authenticated routes are wrapped in AppShell and a ProtectedRoute
 * with the minimum required permission for that screen.
 *
 * Screens are lazy-loaded so the initial bundle stays small.
 * Groups mirror the sidebar nav groups:
 *   Intelligence · Ingestion · Management · Discovery · Process · Analytics & Platform
 *
 * Proxy base paths (for screen agents writing API calls):
 *   /svc/gateway  -> :4000  (auth/users)
 *   /svc/core     -> :4001  (documents/repository/indexing/records)
 *   /svc/workflow -> :4002  (workflows/cases/review/lifecycle)
 *   /svc/notify   -> :4003  (alerts/notifications)
 *   /svc/search   -> :4004  (enterprise search)
 *   /svc/integrate-> :4005  (integrations)
 *   /svc/ai       -> :8000  (AI engine)
 */
import React, { Suspense } from "react";
import { createBrowserRouter, Navigate, type RouterProviderProps } from "react-router-dom";

type Router = RouterProviderProps["router"];
import { AppShell }       from "./components/ui/AppShell.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { Login }          from "./pages/Login.js";
import { Users }          from "./pages/Users.js";

/* ── lazy imports ── */
const Dashboard           = React.lazy(() => import("./pages/Dashboard.js"));
const Capture             = React.lazy(() => import("./pages/Capture.js"));
const Indexing            = React.lazy(() => import("./pages/Indexing.js"));
const Repository          = React.lazy(() => import("./pages/Repository.js"));
const Viewer              = React.lazy(() => import("./pages/Viewer.js"));
const Search              = React.lazy(() => import("./pages/Search.js"));
const WorkflowEngine      = React.lazy(() => import("./pages/WorkflowEngine.js"));
const CaseManagement      = React.lazy(() => import("./pages/CaseManagement.js"));
const ReviewQueue         = React.lazy(() => import("./pages/ReviewQueue.js"));
const Alerts              = React.lazy(() => import("./pages/Alerts.js"));
const IntegrationHub      = React.lazy(() => import("./pages/IntegrationHub.js"));
const AiEngine            = React.lazy(() => import("./pages/AiEngine.js"));
const Security            = React.lazy(() => import("./pages/Security.js"));
const BranchNetwork       = React.lazy(() => import("./pages/BranchNetwork.js"));
const Customer360         = React.lazy(() => import("./pages/Customer360.js"));
const RecordsManagement   = React.lazy(() => import("./pages/RecordsManagement.js"));
const ComplianceAudit     = React.lazy(() => import("./pages/ComplianceAudit.js"));
const DocumentLifecycle   = React.lazy(() => import("./pages/DocumentLifecycle.js"));
const SystemAdministration = React.lazy(() => import("./pages/SystemAdministration.js"));
const Configuration       = React.lazy(() => import("./pages/Configuration.js"));
const ValidationConfig    = React.lazy(() => import("./pages/ValidationConfig.js"));

/* ── loading fallback ── */
const LoadingFallback = (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--sil)", fontSize: 12 }}>
    Loading…
  </div>
);

/* ── route helper ── */
function Shell({ permission, children }: { permission?: string; children: React.ReactNode }) {
  return (
    <ProtectedRoute permission={permission}>
      <AppShell>
        <Suspense fallback={LoadingFallback}>{children}</Suspense>
      </AppShell>
    </ProtectedRoute>
  );
}

export const router: Router = createBrowserRouter([
  /* ── Public ── */
  { path: "/login", element: <Login /> },

  /* ── Intelligence ── */
  { path: "/dashboard",      element: <Shell permission="dashboard:read"><Dashboard /></Shell> },
  { path: "/branch-network", element: <Shell permission="branch:read"><BranchNetwork /></Shell> },
  { path: "/customer360",    element: <Shell permission="customer:read"><Customer360 /></Shell> },

  /* ── Ingestion ── */
  { path: "/capture",   element: <Shell permission="document:capture"><Capture /></Shell> },
  { path: "/indexing",  element: <Shell permission="document:index"><Indexing /></Shell> },
  { path: "/ai-engine", element: <Shell permission="ai:read"><AiEngine /></Shell> },

  /* ── Management ── */
  { path: "/case-management",    element: <Shell permission="case:read"><CaseManagement /></Shell> },
  { path: "/repository",         element: <Shell permission="document:read"><Repository /></Shell> },
  { path: "/records-management", element: <Shell permission="records:read"><RecordsManagement /></Shell> },
  { path: "/document-lifecycle", element: <Shell permission="lifecycle:read"><DocumentLifecycle /></Shell> },

  /* ── Discovery ── */
  { path: "/search", element: <Shell permission="search:read"><Search /></Shell> },
  { path: "/viewer", element: <Shell permission="document:read"><Viewer /></Shell> },

  /* ── Process ── */
  { path: "/workflow-engine",   element: <Shell permission="workflow:read"><WorkflowEngine /></Shell> },
  { path: "/review-queue",      element: <Shell permission="review:read"><ReviewQueue /></Shell> },
  { path: "/compliance-audit",  element: <Shell permission="compliance:read"><ComplianceAudit /></Shell> },
  { path: "/alerts",            element: <Shell permission="alerts:read"><Alerts /></Shell> },

  /* ── Analytics & Platform ── */
  { path: "/integration-hub",       element: <Shell permission="integration:read"><IntegrationHub /></Shell> },
  { path: "/security",              element: <Shell permission="security:read"><Security /></Shell> },
  { path: "/users",                 element: <Shell permission="user:read"><Users /></Shell> },
  { path: "/system-administration", element: <Shell permission="admin:read"><SystemAdministration /></Shell> },
  { path: "/configuration",         element: <Shell permission="admin:access"><Configuration /></Shell> },
  { path: "/validation-config",     element: <Shell permission="admin:access"><ValidationConfig /></Shell> },

  /* ── Default redirect ── */
  { path: "/",  element: <Navigate to="/dashboard" replace /> },
  { path: "*",  element: <Navigate to="/dashboard" replace /> },
]);
