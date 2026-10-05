import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME, ROLE_LABELS } from '../auth/roles';

/** Header and page frame for every signed-in screen. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, signOut } = useAuth();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-solder bg-tray">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to={session ? ROLE_HOME[session.role] : '/login'} className="text-lg font-semibold tracking-tight text-trace">
            ReCircuit
          </Link>
          {session && (
            <nav aria-label="Main" className="hidden items-center gap-4 text-sm sm:flex">
              {[['Home', ROLE_HOME[session.role]], ['Reports', '/reports'], ...(session.role === 'PRODUCER' ? [['Catalogue', '/catalogue']] : [])].map(([label, to]) => (
                <NavLink key={to} to={to ?? '/'} end className={({ isActive }) => (isActive ? 'font-medium text-trace' : 'text-ink-soft hover:text-ink')}>{label}</NavLink>
              ))}
            </nav>
          )}
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-ink-soft sm:inline">{ROLE_LABELS[session.role]}</span>
              <button type="button" onClick={() => void signOut()} className="rounded-md border border-solder px-3 py-1.5 hover:bg-bench">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:px-6 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>{children}</main>
    </div>
  );
}
