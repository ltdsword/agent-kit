import { initialsOf, type AuthClient, type AuthState, type SignedOutReason } from './types';
import { LIMITS, type NotificationStatus, type ZaloLinkCode } from '@/api/protocol';

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
  private password = MockAuthClient.DEMO_PASSWORD;
  private readonly delay: number;
  private notificationState: NotificationStatus = {
    zalo_configured: true,
    bot_link: 'https://zalo.me',
    targets: [],
    sent_this_month: 0,
    monthly_limit: 3000,
  };
  private linkCodeCounter = 0;
  private pendingConnection: { at: number; displayName: string } | null = null;

  constructor(opts: { signedIn?: boolean; delay?: number } = {}) {
    this.delay = opts.delay ?? 600;
    this.state = opts.signedIn ? this.sessionFor('owner', true) : { status: 'signed_out' };
  }

  getState(): AuthState { return this.state; }
  subscribe(l: (s: AuthState) => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  async signIn(username: string, password: string, remember: boolean): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delay));
    if (this.failures >= 5) throw new Error('rate_limited');
    if (!username.trim() || password !== this.password) {
      this.failures += 1;
      throw new Error('invalid_credentials');
    }
    this.failures = 0;
    this.set(this.sessionFor(username.trim(), remember));
  }

  async changePassword(current: string, next: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (current !== this.password) throw new Error('invalid_credentials');
    if (next.length < LIMITS.passwordMinChars) throw new Error('weak_password');
    this.password = next;
  }

  async notificationStatus(): Promise<NotificationStatus> {
    if (this.pendingConnection && Date.now() >= this.pendingConnection.at) {
      const { displayName } = this.pendingConnection;
      this.notificationState.targets = [...this.notificationState.targets, {
        id: `mock-target-${this.notificationState.targets.length + 1}`,
        channel: 'zalo',
        chat_type: 'private',
        display_name: displayName,
        linked_at: new Date().toISOString(),
        broken: false,
      }];
      this.pendingConnection = null;
    }
    return { ...this.notificationState, targets: this.notificationState.targets.map((target) => ({ ...target })) };
  }

  async zaloLinkCode(): Promise<ZaloLinkCode> {
    this.linkCodeCounter += 1;
    const username = this.state.status === 'signed_in' ? this.state.session.user.username : 'owner';
    this.pendingConnection = { at: Date.now() + 5000, displayName: username };
    return {
      code: String(100000 + this.linkCodeCounter).slice(-6),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async sendTestNotification(): Promise<void> {
    if (this.notificationState.targets.length === 0) throw new Error('no_targets');
    this.notificationState.sent_this_month += this.notificationState.targets.length;
  }

  async removeNotificationTarget(id: string): Promise<void> {
    const targets = this.notificationState.targets.filter((target) => target.id !== id);
    if (targets.length === this.notificationState.targets.length) throw new Error('target_not_found');
    this.notificationState.targets = targets;
  }

  signOut(reason: SignedOutReason = 'signed_out'): void {
    this.set({ status: 'signed_out', reason });
  }

  private sessionFor(username: string, remember: boolean): AuthState {
    return { status: 'signed_in', session: { user: { username, initials: initialsOf(username) }, token: 'mock', expiresAt: Date.now() + (remember ? 30 : 1) * DAY } };
  }
  private set(s: AuthState): void { this.state = s; this.listeners.forEach((l) => l(s)); }
}
