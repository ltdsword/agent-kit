import { initialsOf, type AuthClient, type AuthState, type Session, type SignedOutReason } from './types';

const STORAGE_KEY = 'agent-hub.session';

/**
 * Username + password sign-in against the hub backend. Proposed endpoints (add to the backend, plan section 11):
 *
 *   POST /api/v1/auth/login   {username, password, remember}  → {token, expires_at, username}
 *                             401 {error: "invalid_credentials"} · 429 {error: "rate_limited"}
 *   POST /api/v1/auth/logout                                  → 204, revokes the token
 *
 * "Remember me" keeps the session in localStorage (30 days); otherwise sessionStorage (until the tab closes).
 * Not built yet: adjust this file when the backend exists; the login page does not change.
 */
export class HttpAuthClient implements AuthClient {
  private state: AuthState;
  private listeners = new Set<(s: AuthState) => void>();

  constructor(private readonly baseUrl: string) {
    const saved = this.load();
    this.state = saved && saved.expiresAt > Date.now()
      ? { status: 'signed_in', session: saved }
      : { status: 'signed_out', reason: saved ? 'expired' : undefined };
  }

  getState(): AuthState { return this.state; }
  subscribe(l: (s: AuthState) => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  /** Current token, for the data client's Authorization header. */
  token(): string | null {
    return this.state.status === 'signed_in' ? this.state.session.token : null;
  }

  async signIn(username: string, password: string, remember: boolean): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
    } catch {
      throw new Error('hub_unreachable');
    }
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? (res.status === 429 ? 'rate_limited' : res.status === 401 ? 'invalid_credentials' : `http_${res.status}`));
    }
    const r = (await res.json()) as { token: string; expires_at: number; username?: string };
    const name = r.username ?? username.trim();
    const session: Session = { user: { username: name, initials: initialsOf(name) }, token: r.token, expiresAt: r.expires_at };
    this.store(remember).setItem(STORAGE_KEY, JSON.stringify(session));
    this.set({ status: 'signed_in', session });
  }

  signOut(reason: SignedOutReason = 'signed_out'): void {
    const token = this.token();
    if (token && reason === 'signed_out') {
      void fetch(`${this.baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    this.set({ status: 'signed_out', reason });
  }

  private store(remember: boolean): Storage {
    try { return remember ? localStorage : sessionStorage; } catch { return memoryStorage; }
  }
  private load(): Session | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch { return null; }
  }
  private set(s: AuthState): void { this.state = s; this.listeners.forEach((l) => l(s)); }
}

/** Fallback when browser storage is blocked (private mode): the session lasts until reload. */
const mem = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0,
} as Storage;
