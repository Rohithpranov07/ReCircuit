import type { ApiError, Session, TokenResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

export class ApiException extends Error {
  readonly status: number;
  readonly code: string;
  readonly constraint: string | null;
  constructor(status: number, body: ApiError['error']) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.constraint = body.constraint;
  }
}

type Listener<T> = (value: T) => void;

/** The access token lives in memory only; the refresh token is an httpOnly cookie the browser holds. */
let accessToken: string | null = null;
let errorListener: Listener<ApiException> | null = null;
let signedOutListener: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function onApiError(listener: Listener<ApiException> | null): void {
  errorListener = listener;
}
export function onSignedOut(listener: (() => void) | null): void {
  signedOutListener = listener;
}

export function decodeSession(token: string): Session {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('malformed token');
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const data = JSON.parse(json) as Session;
  return { actor_id: data.actor_id, org_id: data.org_id, role: data.role };
}

function parseError(status: number, text: string): ApiException {
  try {
    const body = JSON.parse(text) as Partial<ApiError>;
    if (body.error) return new ApiException(status, body.error);
  } catch {
    /* fall through */
  }
  return new ApiException(status, { code: 'NETWORK_ERROR', constraint: null, message: 'The server sent an unexpected response.' });
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiException(0, { code: 'NETWORK_ERROR', constraint: null, message: 'Cannot reach the server. Check your connection and try again.' });
  }
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      if (!res.ok) return false;
      accessToken = ((await res.json()) as TokenResponse).access_token;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function currentSession(): Session | null {
  return accessToken ? decodeSession(accessToken) : null;
}

interface Options {
  method?: string;
  body?: unknown;
  /** Skip the error toast (the caller shows its own message). */
  quiet?: boolean;
  signal?: AbortSignal;
}

/** Typed JSON call. A 401 triggers one refresh and one retry; if that fails the user is signed out. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', signal: opts.signal };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  let res = await rawFetch(path, init);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await rawFetch(path, init);
    } else {
      accessToken = null;
      signedOutListener?.();
    }
  }
  if (!res.ok) {
    const failure = parseError(res.status, await res.text());
    if (!opts.quiet) errorListener?.(failure);
    throw failure;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('Content-Type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.blob()) as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await api<TokenResponse>('/auth/login', { method: 'POST', body: { email, password }, quiet: true });
  accessToken = res.access_token;
  return decodeSession(res.access_token);
}

export async function logout(): Promise<void> {
  try {
    await api<undefined>('/auth/logout', { method: 'POST', quiet: true });
  } finally {
    accessToken = null;
  }
}
