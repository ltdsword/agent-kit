import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS } from '@/api/protocol';
import { Banner, Crumbs } from '@/components/ui';
import { useAuthClient } from './AuthProvider';

export function ChangePasswordPage() {
  const client = useAuthClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setSuccess(false);
    if (next !== repeat) { setError('The new passwords do not match.'); return; }
    if (next.length < LIMITS.passwordMinChars) { setError('Choose a longer password.'); return; }
    setBusy(true);
    try {
      await client.changePassword(current, next);
      setCurrent(''); setNext(''); setRepeat(''); setSuccess(true);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(code === 'invalid_credentials' ? 'The current password is incorrect.'
        : code === 'weak_password' ? 'Choose a longer password.'
        : code === 'hub_unreachable' ? 'The hub can’t be reached. Try again when the connection is back.'
        : 'Password change failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow fade-in" style={{ paddingTop: 16, gap: 16 }}>
      <Crumbs items={[{ label: 'Workspaces', to: '/' }, { label: 'Change password' }]} />
      <section className="card stack" aria-labelledby="password-h" style={{ padding: 20, gap: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 id="password-h" className="t-h1">Change password</h1>
          <p className="t-2">Choose a new password with at least {LIMITS.passwordMinChars} characters.</p>
        </div>
        {error && <Banner tone="error" icon="alert" role="alert">{error}</Banner>}
        {success && <Banner tone="info" icon="check" role="status">Password changed.</Banner>}
        <form className="stack" style={{ gap: 14 }} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <PasswordField id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
          <PasswordField id="new-password" label="New password" value={next} onChange={setNext} autoComplete="new-password" minLength={LIMITS.passwordMinChars} />
          <PasswordField id="repeat-password" label="Repeat new password" value={repeat} onChange={setRepeat} autoComplete="new-password" minLength={LIMITS.passwordMinChars} />
          <button type="submit" className="btn btn-primary btn-block" style={{ minHeight: 48 }}
            disabled={busy || !current || next.length < LIMITS.passwordMinChars || !repeat}>
            {busy ? 'Changing password…' : 'Change password'}
          </button>
        </form>
        <Link to="/" className="btn btn-ghost btn-block">Back to workspaces</Link>
      </section>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, minLength }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  autoComplete: string; minLength?: number;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="field" type="password" value={value} autoComplete={autoComplete}
        minLength={minLength} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
