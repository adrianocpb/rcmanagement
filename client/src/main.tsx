import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { AdminPage } from './pages/AdminPage';
import { DashboardPage } from './pages/DashboardPage';
import { EpicDetailPage, EpicsPage } from './pages/EpicsPage';
import { LoginPage } from './pages/LoginPage';
import { OutcomeDetailPage, OutcomesPage } from './pages/OutcomesPage';
import { TasksPage } from './pages/TasksPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TasksPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="epicos" element={<EpicsPage />} />
        <Route path="epicos/:id" element={<EpicDetailPage />} />
        <Route path="outcomes" element={<OutcomesPage />} />
        <Route path="outcomes/:id" element={<OutcomeDetailPage />} />
        {user.role === 'admin' && <Route path="admin" element={<AdminPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
