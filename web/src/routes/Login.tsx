import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiException } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';

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
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section aria-hidden className="relative hidden overflow-hidden bg-trace-deep text-bench lg:block">
        <svg className="absolute inset-0 size-full" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none">
          <g stroke="#2f8f7c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55">
            <path d="M40 120h180l40 40h160l40-40h100" />
            <path d="M40 220h120l60 60h220" />
            <path d="M120 340h140l50-50h190" />
            <path d="M40 460h260l60 60h200" />
            <path d="M200 560h120l40 40h200" />
            <path d="M40 680h200l50-50h270" />
          </g>
          <g fill="#093d34" stroke="#e0a526" strokeWidth="2.5">
            <circle cx="220" cy="120" r="7" /><circle cx="460" cy="160" r="7" /><circle cx="220" cy="280" r="7" />
            <circle cx="310" cy="290" r="7" /><circle cx="360" cy="520" r="7" /><circle cx="240" cy="680" r="7" />
          </g>
        </svg>
        <div className="relative flex h-full flex-col justify-end gap-4 p-14">
          <h1 className="max-w-[16ch] text-5xl font-semibold leading-[1.05] tracking-tight">Every part keeps its history.</h1>
          <p className="max-w-[44ch] text-lg text-bench/80">
            Passports for devices, boards, batteries and chips — from the first scan to the recycling certificate.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm">
          <h2 className="text-3xl font-semibold tracking-tight lg:hidden">ReCircuit</h2>
          <p className="mt-1 text-ink-soft lg:hidden">Every part keeps its history.</p>
          <h2 className="mt-8 text-2xl font-semibold tracking-tight lg:mt-0">Sign in</h2>

          <label className="mt-6 block text-sm font-medium" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                 className="mt-1 w-full rounded-md border border-solder bg-tray px-3 py-2.5 text-base" />

          <label className="mt-4 block text-sm font-medium" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 className="mt-1 w-full rounded-md border border-solder bg-tray px-3 py-2.5 text-base" />

          {problem && <p role="alert" className="mt-4 rounded-md border border-fault bg-white px-3 py-2 text-sm text-fault">{problem}</p>}

          <button type="submit" disabled={busy}
                  className="mt-6 w-full rounded-md bg-trace px-4 py-3 font-medium text-white hover:bg-trace-deep disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
