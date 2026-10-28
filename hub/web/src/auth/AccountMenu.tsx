import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { hhmm } from '@/lib/time';
import { useAuth, useAuthClient } from './AuthProvider';

/** Avatar button in the top bar; opens a small menu with the username and Sign out. */
export function AccountMenu() {
  const auth = useAuth();
  const client = useAuthClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open]);

  if (auth.status !== 'signed_in') return null;
  const { user, expiresAt } = auth.session;
  const expires = new Date(expiresAt);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-icon" aria-label={`Account: ${user.username}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <Avatar initials={user.initials} size={30} />
      </button>
      {open && (
        <div className="card fade-in stack" role="menu" aria-label="Account"
          style={{ position: 'absolute', right: 0, top: 50, zIndex: 40, width: 280, padding: 14, gap: 12, boxShadow: 'var(--shadow-pop)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Avatar initials={user.initials} size={36} />
            <span className="stack" style={{ minWidth: 0 }}>
              <span className="trunc" style={{ fontWeight: 600 }}>{user.username}</span>
              <span className="t-small">Signed in as {user.username}</span>
            </span>
          </div>
          <p className="t-small">Session ends {expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at {hhmm(expiresAt)}, or when you sign out.</p>
          <Link className="btn btn-block" role="menuitem" to="/account/password" onClick={() => setOpen(false)}>
            Change password
          </Link>
          <button type="button" className="btn btn-block" role="menuitem" onClick={() => client.signOut()}>
            <Icon name="power" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ initials, size }: { initials: string; size: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: size * 0.4, fontWeight: 700, flex: 'none' }}>
      {initials}
    </span>
  );
}
