import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useClient, useHub, useNow } from '@/state/HubProvider';
import { needsYou, decisionPath } from '@/state/selectors';
import { sinceShort } from '@/lib/time';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { Banner } from './ui';
import { Toast } from './Toast';
import { SimPanel } from './SimPanel';
import { AccountMenu } from '@/auth/AccountMenu';

/** App shell: top bar, connection banner, toast, simulator. Pages render in <Outlet/>. */
export function Layout() {
  const hub = useHub();
  const client = useClient();
  const now = useNow();
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const needs = needsYou(hub);
  const lost = hub.connection === 'lost';
  const secs = (now - hub.lastEventAt) / 1000;
  const stale = !lost && secs > 45;
  const since = sinceShort(hub.lastEventAt, now);
  const liveText = lost ? `Paused · ${since}` : stale ? `Updated ${since}` : `Live · updated ${since}`;

  return (
    <div className={`hub${dark ? ' dark' : ''}`} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar" style={{ padding: '0 16px', gap: 10 }}>
        <Link className="brand" to="/" style={{ minHeight: 44 }}>
          <span className="brand-mark"><Icon name="hub" /></span>
          <span>Agent Hub</span>
        </Link>
        {needs.length > 0 && (
          <button type="button" className="needs" onClick={() => navigate(decisionPath(needs[0]!))} aria-label={`${needs.length} open decisions. Open the oldest.`}>
            <Icon name="bell" />{needs.length}
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="live" role="status" style={{ marginRight: 6 }} title={liveText}>
            <span className={`pulse${lost ? ' off' : stale ? ' stale' : ''}`} />
            <span className="live-text">{liveText}</span>
          </span>
          <button type="button" className="btn btn-icon" onClick={toggle} aria-label={dark ? 'Use light theme' : 'Use dark theme'}>
            <Icon name={dark ? 'sun' : 'moon'} size="lg" />
          </button>
          <AccountMenu />
        </div>
      </header>

      {lost && (
        <Banner tone="stale" icon="wifi-off" full role="alert"
          action={<button type="button" className="btn btn-sm" onClick={() => client.reconnect()}><Icon name="refresh" />Retry now</button>}>
          <strong>Hub connection lost.</strong> Live updates paused, last updated {since}. Showing what we had. Sending is off until it’s back.
        </Banner>
      )}

      <Toast />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
      <SimPanel />
    </div>
  );
}
