import { API_PREFIX, PROTOCOL, PROTOCOL_HEADER, USER_ROUTES, type LoginResponse, type Me } from '@/api/protocol';
import { initialsOf, type AuthClient, type AuthState, type Session, type SignedOutReason } from './types';

const STORAGE_KEY = 'agent-hub.session';

type ApiErrorBody = { error?: { code?: string; message?: string } };

function errorCode(body: unknown, fallback: string): string {
  return (body as ApiErrorBody | null)?.error?.code ?? fallback;
}

export class HttpAuthClient implements AuthClient {
  private state: AuthState;
  private listeners = new Set<(s: AuthState) => void>();

  constructor(private readonly baseUrl: string) {
    const saved = this.load();
    if (saved && saved.expiresAt > Date.now()) {
      this.state = { status: 'loading' };
      void this.restore(saved);
    } else {
      this.state = { status: 'signed_out', reason: saved ? 'expired' : undefined };
    }
  }

  getState(): AuthState { return this.state; }
  subscribe(listener: (state: AuthState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  token(): string | null {
    return this.state.status === 'signed_in' ? this.state.session.token : null;
  }

  async signIn(username: string, password: string, remember: boolean): Promise<void> {
    let response: Response;
    try {
      response = await this.fetch(USER_ROUTES.login.path, {
        method: 'POST', headers: this.headers(true),
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
    } catch {
      throw new Error('hub_unreachable');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(errorCode(body, response.status === 429 ? 'rate_limited' : response.status === 401 ? 'invalid_credentials' : `http_${response.status}`));
    }
    const result = await response.json() as LoginResponse;
    const name = result.username || username.trim();
    const expiresAt = Date.parse(result.expires_at);
    if (!Number.isFinite(expiresAt)) throw new Error('invalid_session');
    const session: Session = { user: { username: name, initials: initialsOf(name) }, token: result.token, expiresAt };
    this.store(remember).setItem(STORAGE_KEY, JSON.stringify(session));
    this.set({ status: 'signed_in', session });
  }

  async changePassword(current: string, next: string): Promise<void> {
    const token = this.token();
    if (!token) throw new Error('unauthorized');
    let response: Response;
    try {
      response = await this.fetch(USER_ROUTES.password.path, {
        method: 'POST', headers: this.headers(true, token),
        body: JSON.stringify({ current, new: next }),
      });
    } catch {
      throw new Error('hub_unreachable');
    }
    if (response.status === 401) {
      const body = await response.json().catch(() => ({}));
      const code = errorCode(body, 'invalid_credentials');
      if (code === 'unauthorized') this.signOut('expired');
      throw new Error(code);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(errorCode(body, `http_${response.status}`));
    }
  }

  signOut(reason: SignedOutReason = 'signed_out'): void {
    const token = this.token();
    if (token && reason === 'signed_out') {
      void this.fetch(USER_ROUTES.logout.path, { method: 'POST', headers: this.headers(false, token) }).catch(() => {});
    }
    try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
    this.set({ status: 'signed_out', reason });
  }

  private async restore(saved: Session): Promise<void> {
    try {
      const response = await this.fetch(USER_ROUTES.me.path, { method: 'GET', headers: this.headers(false, saved.token) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          this.signOut('expired');
          return;
        }
        throw new Error(errorCode(body, `http_${response.status}`));
      }
      const me = await response.json() as Me;
      const username = me.username || saved.user.username;
      const session = { ...saved, user: { username, initials: initialsOf(username) } };
      this.saveRestored(session);
      this.set({ status: 'signed_in', session });
    } catch (error) {
      if ((error as Error).message === 'unauthorized') {
        this.signOut('expired');
        return;
      }
      this.set({ status: 'signed_in', session: saved });
    }
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${API_PREFIX}${path}`, init);
  }

  private headers(json: boolean, token?: string): HeadersInit {
    return {
      [PROTOCOL_HEADER]: String(PROTOCOL),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private store(remember: boolean): Storage {
    try { return remember ? localStorage : sessionStorage; } catch { return memoryStorage; }
  }

  private saveRestored(session: Session): void {
    try {
      const storage = sessionStorage.getItem(STORAGE_KEY) ? sessionStorage : localStorage;
      storage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch { /* keep the in-memory session */ }
  }

  private load(): Session | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) as Session : null;
    } catch { return null; }
  }

  private set(state: AuthState): void { this.state = state; this.listeners.forEach((listener) => listener(state)); }
}

const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;
