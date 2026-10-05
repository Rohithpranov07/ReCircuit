import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME, ROLE_LABELS } from '../auth/roles';

export function Mark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={className}>
      <circle cx="16" cy="16" r="16" fill="#fc5000" />
      <g fill="#070607"><circle cx="9" cy="16" r="2" /><circle cx="16" cy="16" r="2" /><circle cx="23" cy="16" r="2" /><circle cx="12.5" cy="9.5" r="1.4" /><circle cx="19.5" cy="9.5" r="1.4" /><circle cx="12.5" cy="22.5" r="1.4" /><circle cx="19.5" cy="22.5" r="1.4" /></g>
    </svg>
  );
}

/** Frame for every signed-in screen: the navigation sits in a Limestone pill on the Pumice canvas. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, signOut } = useAuth();
  const links: [string, string][] = session
    ? [['Home', ROLE_HOME[session.role]], ['Reports', '/reports'], ...(session.role === 'PRODUCER' ? [['Catalogue', '/catalogue'] as [string, string]] : [])]
    : [];
  return (
    <div className="min-h-dvh">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-obsidian focus:px-5 focus:py-2 focus:text-chalk">
        Skip to content
      </a>
      <header className="mx-auto max-w-[1280px] px-4 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 rounded-full bg-limestone py-2 pl-5 pr-2">
          <Link to={session ? ROLE_HOME[session.role] : '/login'} className="flex items-center gap-2.5 rounded-full">
            <Mark />
            <span className="font-display text-2xl tracking-wide">ReCircuit</span>
          </Link>
          {session && (
            <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
              {links.map(([label, to], i) => (
                <span key={to} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden className="h-5 border-l-[1.5px] border-dotted border-obsidian" />}
                  <NavLink to={to} end className={({ isActive }) => `rounded-full px-4 py-1.5 ${isActive ? 'bg-ember' : 'hover:bg-pumice'}`}>{label}</NavLink>
                </span>
              ))}
            </nav>
          )}
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden rounded-full bg-sulfur px-3 py-1 sm:inline">{ROLE_LABELS[session.role]}</span>
              <button type="button" onClick={() => void signOut()} className="rounded-full border-[1.5px] border-obsidian px-5 py-2 hover:bg-obsidian hover:text-chalk">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="content" className={`mx-auto px-4 pb-20 pt-10 sm:px-6 ${wide ? 'max-w-[1280px]' : 'max-w-4xl'}`}>{children}</main>
    </div>
  );
}
