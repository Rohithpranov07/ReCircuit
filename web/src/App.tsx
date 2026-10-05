import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { ROLE_HOME } from './auth/roles';
import { ToastProvider } from './components/Toast';
import { lazy, Suspense } from 'react';
import Login from './routes/Login';
import RoleHome from './routes/RoleHome';
import type { Role } from './api/types';

const PassportPage = lazy(() => import('./routes/passport/PassportPage'));
const PublicPassportPage = lazy(() => import('./routes/public/PublicPassportPage'));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<p className="p-8 text-ink-soft">Loading…</p>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/p/:passportUid" element={<PublicPassportPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/unit/:passportUid" element={<PassportPage />} />
              </Route>
              {(Object.keys(ROLE_HOME) as Role[]).map((role) => (
                <Route key={role} element={<RequireAuth roles={[role]} />}>
                  <Route path={ROLE_HOME[role]} element={<RoleHome />} />
                </Route>
              ))}
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
