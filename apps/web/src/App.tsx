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
import { DesignerPage } from '@/modules/workflow-templates/DesignerPage';
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
// Wave B — Retention + WORM admin
import { RetentionPage } from '@/modules/retention/Page';
// CC3 — Admin Settings shell + panels
import { SettingsLayout } from '@/modules/admin/settings/SettingsLayout';
import { I18nPanel } from '@/modules/admin/settings/panels/I18nPanel';
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
import { DocbrainPanel } from '@/modules/admin/settings/panels/DocbrainPanel';
import { NotificationsPanel } from '@/modules/admin/settings/panels/NotificationsPanel';
import { MobilePanel } from '@/modules/admin/settings/panels/MobilePanel';
import { IntegrationsPanel } from '@/modules/admin/settings/panels/IntegrationsPanel';
import { SearchPanel } from '@/modules/admin/settings/panels/SearchPanel';
import { WorkflowTemplatesPanel } from '@/modules/admin/settings/panels/WorkflowTemplatesPanel';
import { UsersPanel } from '@/modules/admin/settings/panels/UsersPanel';
// Wave B — Users v2
import { SetPasswordPage } from '@/pages/SetPasswordPage';
import { CommandPalette } from '@/components/CommandPalette';
import { useTenant } from '@/store/tenant';
// Wave C — Audit Log v2
import { AuditLogPage } from '@/modules/audit/AuditLogPage';
// Wave C — DSAR Console
import { DSARPage } from '@/modules/dsar/DSARPage';
import { DsarPanel } from '@/modules/admin/settings/panels/DsarPanel';
// Wave C — Regulator Reports
import { RegulatorReportsPage } from '@/modules/regulator-reports/Page';
import { TemplateDetail } from '@/modules/regulator-reports/TemplateDetail';
import { RegulatorReportsPanel } from '@/modules/admin/settings/panels/RegulatorReportsPanel';
// Wave C — Notifications feed
import { NotificationsPage } from '@/modules/notifications/Page';
// Wave E — forgot / reset password
import ForgotPasswordPage from '@/modules/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/modules/auth/ResetPasswordPage';

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

    // Use product_name for the browser tab title when set; fall back to display_name.
    const pageTitle = tenant.product_name ?? tenant.display_name;
    document.title = pageTitle;

    // Update favicon: prefer favicon_url (branding namespace), then favicon_path (tenant row).
    const faviconHref = tenant.favicon_url ?? tenant.favicon_path;
    const link = document.querySelector<HTMLLinkElement>('link[rel=icon]');
    if (link && faviconHref) {
      link.href = faviconHref;
    }

    // Drive the CSS custom property so bg-brand-primary picks up the tenant's
    // primary colour. The static :root fallback in index.css prevents flash
    // before this effect fires on first render.
    document.documentElement.style.setProperty('--brand-primary', tenant.primary_color);
  }, [
    tenant.display_name,
    tenant.product_name,
    tenant.favicon_path,
    tenant.favicon_url,
    tenant.primary_color,
  ]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <TenantBrandingEffect />
          <Routes>
            {/* Anonymous routes — no session required */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
              <Route path="/workflows/templates/:id/design" element={<DesignerPage />} />
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
              <Route path="/admin/retention" element={<RetentionPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
              <Route path="/admin/ai-glossary" element={<GlossaryPage />} />
              <Route path="/admin/aml" element={<AmlScreeningPage />} />
              <Route path="/admin/kyc/face-match" element={<FaceMatchPage />} />
              {/* Wave C — DSAR Console */}
              <Route path="/admin/dsar" element={<DSARPage />} />
              {/* Wave C — Notifications feed */}
              <Route path="/notifications" element={<NotificationsPage />} />
              {/* Wave C — Regulator Reports */}
              <Route path="/regulator-reports" element={<RegulatorReportsPage />} />
              <Route path="/regulator-reports/:id" element={<TemplateDetail />} />

              {/* CC3 — Admin Settings */}
              <Route path="/admin/settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="/admin/settings/branding" replace />} />
                <Route path="branding"      element={<BrandingPanel />} />
                {/* Wave D — i18n namespace #17 */}
                <Route path="i18n"          element={<I18nPanel />} />
                <Route path="locales"       element={<LocalesPanel />} />
                <Route path="tenants"       element={<TenantsPanel />} />
                <Route path="capture"       element={<CapturePanel />} />
                <Route path="ocr"           element={<OcrPanel />} />
                <Route path="doctypes"      element={<DoctypesPanel />} />
                <Route path="workflows"            element={<WorkflowsPanel />} />
                <Route path="workflow-templates"  element={<WorkflowTemplatesPanel />} />
                <Route path="users-auth"     element={<UsersPanel />} />
                <Route path="rbac"          element={<RbacPanel />} />
                <Route path="abac"          element={<AbacPanel />} />
                <Route path="aml"           element={<AmlPanel />} />
                <Route path="retention"     element={<RetentionPanel />} />
                <Route path="audit"         element={<AuditPanel />} />
                <Route path="integrations"  element={<IntegrationsPanel />} />
                <Route path="notifications" element={<NotificationsPanel />} />
                <Route path="mobile"        element={<MobilePanel />} />
                <Route path="search"        element={<SearchPanel />} />
                <Route path="docbrain"      element={<DocbrainPanel />} />
                <Route path="dsar"                element={<DsarPanel />} />
                <Route path="regulator-reports"  element={<RegulatorReportsPanel />} />
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
