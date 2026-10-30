import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { NotificationStatus } from '@/api/protocol';
import { hhmm } from '@/lib/time';
import { useAuth, useAuthClient } from './AuthProvider';
import { NotificationsCard } from './NotificationsCard';

/** Avatar button in the top bar; opens a small menu with the username and Sign out. */
export function AccountMenu() {
  const auth = useAuth();
  const client = useAuthClient();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !notificationsOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open, notificationsOpen]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void client.notificationStatus().then((status) => {
      if (active) setNotificationStatus(status);
    }).catch(() => {
      if (active) setNotificationStatus(null);
    });
    return () => { active = false; };
  }, [open, client]);

  if (auth.status !== 'signed_in') return null;
  const { user, expiresAt } = auth.session;
  const expires = new Date(expiresAt);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-icon" aria-label={`Account: ${user.username}`} aria-expanded={open || notificationsOpen} aria-haspopup="menu" onClick={() => {
        if (notificationsOpen) {
          setNotificationsOpen(false);
          setOpen(true);
        } else {
          setOpen((v) => !v);
        }
      }}>
        <Avatar initials={user.initials} size={30} />
      </button>
      {notificationsOpen && (
        <NotificationsCard client={client} onClose={() => setNotificationsOpen(false)} onStatusChange={setNotificationStatus} />
      )}
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
          {notificationStatus?.zalo_configured && (
            <button type="button" className="btn btn-block" role="menuitem" onClick={() => {
              setOpen(false);
              setNotificationsOpen(true);
            }}>
              <Icon name="bell" />Notifications
              <span aria-label={notificationStatus.targets.length > 0 ? 'Connected' : 'Not connected'} title={notificationStatus.targets.length > 0 ? 'Connected' : 'Not connected'}
                style={{ width: 8, height: 8, borderRadius: '50%', background: notificationStatus.targets.length > 0 ? 'var(--success, #2eaa66)' : 'var(--text-muted, #888)', marginLeft: 'auto', flex: 'none' }} />
            </button>
          )}
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
