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
import { ComingSoonPage } from '@/modules/_placeholder/ComingSoonPage';

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

            {/* Placeholders — deliberate no-op until their milestone. */}
            <Route path="/indexing"     element={<ComingSoonPage />} />
            <Route path="/workflows"    element={<ComingSoonPage />} />
            <Route path="/ai"           element={<ComingSoonPage />} />
            <Route path="/reports"      element={<ComingSoonPage />} />
            <Route path="/compliance"   element={<ComingSoonPage />} />
            <Route path="/integration"  element={<ComingSoonPage />} />
            <Route path="/security"     element={<ComingSoonPage />} />
            <Route path="/users"        element={<ComingSoonPage />} />
            <Route path="/admin"        element={<ComingSoonPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
