import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/layout/RequireAuth';
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
