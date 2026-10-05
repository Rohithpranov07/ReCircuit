import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { currentSession, login as apiLogin, logout as apiLogout, onSignedOut, refreshSession } from '../api/client';
import type { Session } from '../api/types';

interface AuthApi {
  session: Session | null;
  /** false until the first attempt to restore a session from the refresh cookie has finished */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<Session>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSignedOut(() => setSession(null));
    let alive = true;
    void refreshSession().then((ok) => {
      if (!alive) return;
      setSession(ok ? currentSession() : null);
      setReady(true);
    });
    return () => {
      alive = false;
      onSignedOut(null);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await apiLogin(email, password);
    setSession(s);
    return s;
  }, []);
  const signOut = useCallback(async () => {
    await apiLogout();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, ready, signIn, signOut }), [session, ready, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
