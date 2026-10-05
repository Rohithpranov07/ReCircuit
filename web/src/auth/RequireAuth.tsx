import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from './AuthContext';
import { ROLE_HOME } from './roles';

/** Route guard: signed in, and (optionally) holding one of `roles`. The API and database decide again. */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <p className="p-8 text-ink-soft">Checking your session…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(session.role)) return <Navigate to={ROLE_HOME[session.role]} replace />;
  return <Outlet />;
}
