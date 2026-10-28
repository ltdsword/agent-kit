/**
 * Sign-in for the hosted UI (e.g. on Vercel): any computer or phone can open it and sign in with a
 * username and password.
 *
 * The UI only holds a session token. The backend (`agent-hub serve`) must check that token on every
 * request, store passwords hashed (argon2id or bcrypt) and rate-limit sign-in. Hiding screens in the
 * browser is not security.
 */
export interface User {
  username: string;
  initials: string;
}

export interface Session {
  user: User;
  token: string;
  expiresAt: number;
}

/** Why the user is on the sign-in page; shown as a short note. */
export type SignedOutReason = 'signed_out' | 'expired';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_in'; session: Session }
  | { status: 'signed_out'; reason?: SignedOutReason };

export interface AuthClient {
  getState(): AuthState;
  subscribe(listener: (s: AuthState) => void): () => void;
  /** Throws `invalid_credentials`, `rate_limited` or `hub_unreachable`. */
  signIn(username: string, password: string, remember: boolean): Promise<void>;
  /** Throws `invalid_credentials`, `weak_password`, or `hub_unreachable`. */
  changePassword(current: string, next: string): Promise<void>;
  signOut(reason?: SignedOutReason): void;
}

/** Error codes thrown by AuthClient.signIn, mapped to text on the login page. */
export const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: 'Wrong username or password.',
  weak_password: 'Choose a longer password.',
  rate_limited: 'Too many tries. Wait a minute, then try again.',
  hub_unreachable: 'The hub can’t be reached. Try again when the connection is back.',
};

export function initialsOf(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const s = parts.length > 1 ? (parts[0]![0] ?? '') + (parts[1]![0] ?? '') : (parts[0] ?? '').slice(0, 2);
  return s.toUpperCase() || '?';
}
