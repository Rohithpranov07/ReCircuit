import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';

/** Placeholder home for every role; the real dashboards arrive in T4.3 to T4.5. */
export default function RoleHome() {
  const { session, signOut } = useAuth();
  if (!session) return null;
  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-solder pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{ROLE_LABELS[session.role]} workspace</h1>
        <button type="button" onClick={() => void signOut()} className="rounded-md border border-solder bg-tray px-3 py-1.5 text-sm">
          Sign out
        </button>
      </header>
      <p className="mt-6 text-ink-soft">Signed in as actor {session.actor_id} of organisation {session.org_id}.</p>
    </main>
  );
}
