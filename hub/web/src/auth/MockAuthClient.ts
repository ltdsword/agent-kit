import { initialsOf, type AuthClient, type AuthState, type SignedOutReason } from './types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * In-memory sign-in for development and demos.
 * Accepts any username with the password `agenthub`. Five wrong tries in a row → rate_limited.
 */
export class MockAuthClient implements AuthClient {
  static readonly DEMO_PASSWORD = 'agenthub';
  private state: AuthState;
  private listeners = new Set<(s: AuthState) => void>();
  private failures = 0;
  private readonly delay: number;

  constructor(opts: { signedIn?: boolean; delay?: number } = {}) {
    this.delay = opts.delay ?? 600;
    this.state = opts.signedIn ? this.sessionFor('owner', true) : { status: 'signed_out' };
  }

  getState(): AuthState { return this.state; }
  subscribe(l: (s: AuthState) => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  async signIn(username: string, password: string, remember: boolean): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delay));
    if (this.failures >= 5) throw new Error('rate_limited');
    if (!username.trim() || password !== MockAuthClient.DEMO_PASSWORD) {
      this.failures += 1;
      throw new Error('invalid_credentials');
    }
    this.failures = 0;
    this.set(this.sessionFor(username.trim(), remember));
  }

  signOut(reason: SignedOutReason = 'signed_out'): void {
    this.set({ status: 'signed_out', reason });
  }

  private sessionFor(username: string, remember: boolean): AuthState {
    return { status: 'signed_in', session: { user: { username, initials: initialsOf(username) }, token: 'mock', expiresAt: Date.now() + (remember ? 30 : 1) * DAY } };
  }
  private set(s: AuthState): void { this.state = s; this.listeners.forEach((l) => l(s)); }
}
