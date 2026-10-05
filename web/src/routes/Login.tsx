import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiException } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { Mark } from '../components/AppShell';
import { Button, Field, inputClass } from '../components/ui';

/** Hero halftone: a dot grid whose dots shrink from the top-right corner (Ember) toward the bottom-left (Plasma Violet). */
function Halftone() {
  const dots: React.ReactNode[] = [];
  const cols = 26;
  const rows = 34;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const d = Math.hypot((cols - 1 - c) / cols, r / rows);           // distance from the top-right corner
      const size = Math.max(0.6, 7.2 * Math.max(0, 1.05 - d * 1.15));
      if (size > 0.7) dots.push(<circle key={`${r}-${c}`} cx={c * 16 + 8} cy={r * 16 + 8} r={size} />);
    }
  }
  return (
    <svg aria-hidden className="absolute inset-0 size-full" viewBox={`0 0 ${cols * 16} ${rows * 16}`} preserveAspectRatio="xMidYMid slice" fill="#fc5000">
      {dots}
    </svg>
  );
}

export default function Login() {
  const { session, ready, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && session) return <Navigate to={ROLE_HOME[session.role]} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const s = await signIn(email.trim(), password);
      navigate(ROLE_HOME[s.role], { replace: true });
    } catch (err) {
      setProblem(err instanceof ApiException && err.status === 401
        ? 'That email and password do not match, or the account is locked for a few minutes after repeated failures.'
        : err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[1280px] gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section aria-hidden className="relative hidden min-h-[640px] overflow-hidden rounded-[40px] bg-plasma-violet lg:block">
        <Halftone />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-plasma-violet via-plasma-violet/85 to-transparent p-12 pt-40">
          <h1 className="font-display text-[clamp(4.5rem,8vw,7.5rem)] leading-[.94] tracking-[.02em] text-chalk">
            Every part keeps its history
          </h1>
        </div>
      </section>

      <section className="flex flex-col justify-between gap-12 rounded-[40px] bg-limestone p-8 sm:p-12">
        <div className="flex items-center gap-2.5">
          <Mark className="size-10" />
          <span className="font-display text-3xl tracking-wide">ReCircuit</span>
        </div>
        <form onSubmit={(e) => void submit(e)} className="w-full">
          <h1 className="h-page lg:hidden">Every part keeps its history</h1>
          <h2 className="h-page mt-8 lg:mt-0">Sign in</h2>
          <p className="mt-3 max-w-[40ch] text-ink-soft">Passports for devices, boards, batteries and chips, from the first scan to the recycling certificate.</p>

          <div className="mt-8 space-y-4">
            <Field label="Email" htmlFor="email">
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Password" htmlFor="password">
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
          </div>

          {problem && <p role="alert" className="mt-5 rounded-[20px] border-[1.5px] border-fault bg-chalk px-4 py-3 text-sm text-fault">{problem}</p>}

          <Button type="submit" disabled={busy} className="mt-8 w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className="text-xs text-ink-soft">Public passports open without signing in: scan the QR code on any part.</p>
      </section>
    </main>
  );
}
