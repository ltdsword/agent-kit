import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { useAuth, useAuthClient } from './AuthProvider';
import { AUTH_ERRORS } from './types';

const REASON_TEXT = {
  signed_out: 'You signed out of this browser.',
  expired: 'Your session expired. Sign in again; nothing was lost.',
} as const;

/** Username + password. Same page on a laptop and a phone. */
export function LoginPage() {
  const auth = useAuth();
  const client = useAuthClient();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const { dark, toggle } = useTheme();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === 'signed_out' && auth.reason) setNotice(REASON_TEXT[auth.reason]);
  }, [auth]);

  if (auth.status === 'signed_in') return <Navigate to={next} replace />;

  const submit = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await client.signIn(username, password, remember);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(AUTH_ERRORS[code] ?? 'Sign-in failed. Try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`hub${dark ? ' dark' : ''}`} style={{ minHeight: '100vh' }}>
      <main className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: 18 }}>
        <section className="card stack" aria-labelledby="login-h" style={{ width: '100%', maxWidth: 400, padding: '28px 24px', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="brand-mark" style={{ width: 36, height: 36, borderRadius: 9 }}><Icon name="hub" size="lg" /></span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Agent Hub</span>
            <button type="button" className="btn btn-icon" onClick={toggle} aria-label={dark ? 'Use light theme' : 'Use dark theme'} style={{ marginLeft: 'auto', marginRight: -10 }}>
              <Icon name={dark ? 'sun' : 'moon'} size="lg" />
            </button>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <h1 id="login-h" className="t-h1">Sign in</h1>
            <p className="t-2">Answer your agents’ decisions and read their reports from any computer or phone.</p>
          </div>

          {notice && <Banner tone="info" icon="info" role="status">{notice}</Banner>}
          {error && <Banner tone="error" icon="alert" role="alert">{error}</Banner>}

          <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div>
              <label className="field-label" htmlFor="login-user">Username</label>
              <input id="login-user" className={`field${error ? ' err' : ''}`} type="text" value={username} autoComplete="username"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                onChange={(e) => { setUsername(e.target.value); setError(null); }} />
            </div>
            <div>
              <label className="field-label" htmlFor="login-pass">Password</label>
              <div style={{ position: 'relative' }}>
                <input id="login-pass" className={`field${error ? ' err' : ''}`} type={showPassword ? 'text' : 'password'} value={password}
                  autoComplete="current-password" style={{ paddingRight: 52 }}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }} />
                <button type="button" className="btn btn-icon" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                  style={{ position: 'absolute', right: 0, top: 0 }}>
                  <Icon name={showPassword ? 'eye-off' : 'eye'} />
                </button>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
              Keep me signed in on this device for 30 days
            </label>
            <button type="submit" className="btn btn-primary btn-block" style={{ minHeight: 48, fontSize: 15 }}
              disabled={busy || !username.trim() || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="t-small">Forgot the password? Reset it on your computer with <code className="mono">agent-hub passwd</code>.</p>
        </section>
        <p className="t-small" style={{ maxWidth: 400, textAlign: 'center' }}>
          Signing in lets you watch, answer and prompt. It can’t start a workspace: that only happens on your computer.
        </p>
      </main>
    </div>
  );
}
