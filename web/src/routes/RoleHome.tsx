import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import { AppShell } from '../components/AppShell';
import { PassportFinder } from './passport/PassportFinder';

/** Placeholder home for every role; the real dashboards arrive in T4.3 to T4.5. */
export default function RoleHome() {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <AppShell>
      <h1 className="h-page">{ROLE_LABELS[session.role]} workspace</h1>
      <div className="mt-6"><PassportFinder /></div>
    </AppShell>
  );
}
