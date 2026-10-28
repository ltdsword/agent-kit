import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { decisionKey } from '@/api/client';
import { useClient, useHub } from '@/state/HubProvider';
import { useAuthClient } from '@/auth/AuthProvider';
import { Icon } from './Icon';

/** Development-only panel that fires live events (only shown when the client is the mock). */
export function SimPanel() {
  const client = useClient();
  const auth = useAuthClient();
  useHub(); // re-render when state changes so labels stay current
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (!client.actions) return null;

  // The panel lives in the layout, above the routes, so it reads ids from the URL itself.
  const m = /^\/w\/([^/]+)(?:\/d\/([^/]+)\/([^/]+))?/.exec(pathname);
  const ctx = {
    workspaceId: m?.[1],
    decisionKey: m?.[1] && m[2] && m[3] ? decisionKey(m[1], m[2], m[3]) : undefined,
  };
  const actions = open
    ? [...client.actions(ctx), { label: 'Session expires (sign in again)', run: () => auth.signOut('expired') }]
    : [];

  return (
    <div className="sim">
      {open && (
        <div className="sim-panel" role="menu" aria-label="Simulate events">
          <span className="t-label" style={{ padding: '8px 10px 4px' }}>Simulate a live event</span>
          {actions.map((a) => (
            <button key={a.label} type="button" role="menuitem" onClick={() => { setOpen(false); a.run(); }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="sim-fab" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="flask" />
        Simulate
      </button>
    </div>
  );
}
