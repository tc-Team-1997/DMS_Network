import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { ToastProvider } from '@/components/ui';
import { LoginPage } from '@/modules/auth/LoginPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { CapturePage } from '@/modules/capture/CapturePage';
import { RepositoryPage } from '@/modules/repository/RepositoryPage';
import { ViewerPage } from '@/modules/viewer/ViewerPage';
import { SearchPage } from '@/modules/search/SearchPage';
import { AlertsPage } from '@/modules/alerts/AlertsPage';
import { WorkflowsPage } from '@/modules/workflows/WorkflowsPage';
import { IndexingPage } from '@/modules/indexing/IndexingPage';
import { ReportsPage } from '@/modules/reports/ReportsPage';
import { TemplatesPage } from '@/modules/workflow-templates/TemplatesPage';
import { AIEnginePage } from '@/modules/ai/AIEnginePage';
import { ChatPage } from '@/modules/ai/ChatPage';
import { CompliancePage } from '@/modules/compliance/CompliancePage';
import { IntegrationsPage } from '@/modules/integrations/IntegrationsPage';
import { SecurityPage } from '@/modules/security/SecurityPage';
import { UsersPage } from '@/modules/users/UsersPage';
import { AdminPage } from '@/modules/admin/AdminPage';
import { DedupSettingsPage } from '@/modules/admin/DedupSettingsPage';
import { DocumentTypesPage } from '@/modules/document-types/DocumentTypesPage';
import { GlossaryPage } from '@/modules/ai/GlossaryPage';
import { AmlScreeningPage } from '@/modules/aml-screening/AmlScreeningPage';
import { FaceMatchPage } from '@/modules/face-match/FaceMatchPage';
// CC3 — Admin Settings shell + panels
import { SettingsLayout } from '@/modules/admin/settings/SettingsLayout';
import { BrandingPanel } from '@/modules/admin/settings/panels/BrandingPanel';
import { LocalesPanel } from '@/modules/admin/settings/panels/LocalesPanel';
import { TenantsPanel } from '@/modules/admin/settings/panels/TenantsPanel';
import { CapturePanel } from '@/modules/admin/settings/panels/CapturePanel';
import { OcrPanel } from '@/modules/admin/settings/panels/OcrPanel';
import { DoctypesPanel } from '@/modules/admin/settings/panels/DoctypesPanel';
import { WorkflowsPanel } from '@/modules/admin/settings/panels/WorkflowsPanel';
import { RbacPanel } from '@/modules/admin/settings/panels/RbacPanel';
import { AbacPanel } from '@/modules/admin/settings/panels/AbacPanel';
import { AmlPanel } from '@/modules/admin/settings/panels/AmlPanel';
import { RetentionPanel } from '@/modules/admin/settings/panels/RetentionPanel';
import { AuditPanel } from '@/modules/admin/settings/panels/AuditPanel';
import { NotificationsPanel } from '@/modules/admin/settings/panels/NotificationsPanel';
import { MobilePanel } from '@/modules/admin/settings/panels/MobilePanel';
import { IntegrationsPanel } from '@/modules/admin/settings/panels/IntegrationsPanel';
import { SearchPanel } from '@/modules/admin/settings/panels/SearchPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { useTenant } from '@/store/tenant';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err: unknown) => {
        // Don't retry 4xx — those won't heal on retry.
        const status = (err as { status?: number } | null)?.status ?? 0;
        if (status >= 400 && status < 500) return false;
        return count < 2;
      },
      staleTime: 30_000,
    },
  },
});

/**
 * Applies tenant branding to the document layer once the real tenant resolves.
 * Gated on tenant.display_name being truthy so we never render
 * " · Document Management" while the loading stub is still in place.
 * The static :root { --brand-primary } in index.css prevents any flash.
 */
function TenantBrandingEffect() {
  const tenant = useTenant();

  useEffect(() => {
    // Only fire once the real tenant payload has landed (display_name is non-empty).
    if (!tenant.display_name) return;

    document.title = `${tenant.display_name} · Document Management`;

    // Update favicon if the tenant provides one.
    const link = document.querySelector<HTMLLinkElement>('link[rel=icon]');
    if (link && tenant.favicon_path) {
      link.href = tenant.favicon_path;
    }

    // Drive the CSS custom property so bg-brand-primary picks up the tenant's
    // primary colour. The static :root fallback in index.css prevents flash
    // before this effect fires on first render.
    document.documentElement.style.setProperty('--brand-primary', tenant.primary_color);
  }, [tenant.display_name, tenant.favicon_path, tenant.primary_color]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <TenantBrandingEffect />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/capture" element={<CapturePage />} />
              <Route path="/repository" element={<RepositoryPage />} />
              <Route path="/viewer" element={<ViewerPage />} />
              <Route path="/viewer/:id" element={<ViewerPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflows/templates" element={<TemplatesPage />} />
              <Route path="/indexing" element={<IndexingPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/ai" element={<ChatPage />} />
              <Route path="/ai/engine" element={<AIEnginePage />} />
              <Route path="/compliance" element={<CompliancePage />} />
              <Route path="/integration" element={<IntegrationsPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/document-types" element={<DocumentTypesPage />} />
              <Route path="/admin/dedup-settings" element={<DedupSettingsPage />} />
              <Route path="/admin/ai-glossary" element={<GlossaryPage />} />
              <Route path="/admin/aml" element={<AmlScreeningPage />} />
              <Route path="/admin/kyc/face-match" element={<FaceMatchPage />} />

              {/* CC3 — Admin Settings */}
              <Route path="/admin/settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="/admin/settings/branding" replace />} />
                <Route path="branding"      element={<BrandingPanel />} />
                <Route path="locales"       element={<LocalesPanel />} />
                <Route path="tenants"       element={<TenantsPanel />} />
                <Route path="capture"       element={<CapturePanel />} />
                <Route path="ocr"           element={<OcrPanel />} />
                <Route path="doctypes"      element={<DoctypesPanel />} />
                <Route path="workflows"     element={<WorkflowsPanel />} />
                <Route path="rbac"          element={<RbacPanel />} />
                <Route path="abac"          element={<AbacPanel />} />
                <Route path="aml"           element={<AmlPanel />} />
                <Route path="retention"     element={<RetentionPanel />} />
                <Route path="audit"         element={<AuditPanel />} />
                <Route path="integrations"  element={<IntegrationsPanel />} />
                <Route path="notifications" element={<NotificationsPanel />} />
                <Route path="mobile"        element={<MobilePanel />} />
                <Route path="search"        element={<SearchPanel />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>

          {/* Global Cmd-K command palette — mounted after Routes so useNavigate is available */}
          <CommandPalette />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
