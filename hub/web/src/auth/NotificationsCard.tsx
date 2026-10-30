import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { NotificationStatus, ZaloLinkCode } from '@/api/protocol';
import { Icon } from '@/components/Icon';
import type { AuthClient } from './types';

export function NotificationsCard({ client, onClose, onStatusChange }: {
  client: AuthClient;
  onClose: () => void;
  onStatusChange: (status: NotificationStatus) => void;
}) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [code, setCode] = useState<ZaloLinkCode | null>(null);
  const [connectingAnother, setConnectingAnother] = useState(false);
  const [connectedNotice, setConnectedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Newest linked_at seen; a newer one means a chat was just linked (or a broken one relinked).
  const lastLinkedAt = useRef<string | null | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await client.notificationStatus();
      const newest = next.targets.reduce<NotificationStatus['targets'][number] | null>(
        (best, target) => (!best || target.linked_at > best.linked_at ? target : best), null);
      const newestAt = newest?.linked_at ?? null;
      if (lastLinkedAt.current !== undefined && newest && (lastLinkedAt.current === null || newestAt! > lastLinkedAt.current)) {
        setConnectedNotice(newest.display_name ?? 'chat');
        setConnectingAnother(false);
        setCode(null);
      }
      lastLinkedAt.current = newestAt;
      setStatus(next);
      onStatusChange(next);
      setError(null);
    } catch {
      setError('Could not load notification settings.');
    }
  }, [client, onStatusChange]);

  const createCode = useCallback(async () => {
    setLoadingCode(true);
    setError(null);
    try {
      setCode(await client.zaloLinkCode());
    } catch {
      setError('Could not create a link code.');
    } finally {
      setLoadingCode(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!status || (status.targets.length > 0 && !connectingAnother)) return;
    const timer = window.setInterval(() => { void refreshStatus(); }, 3000);
    return () => window.clearInterval(timer);
  }, [status?.targets.length, connectingAnother, refreshStatus]);

  useEffect(() => {
    if (!status || (status.targets.length > 0 && !connectingAnother) || code || loadingCode || error) return;
    void createCode();
  }, [status, connectingAnother, code, loadingCode, error, createCode]);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  const botLink = status?.bot_link ?? null;
  const qrSvg = useMemo(() => {
    if (!botLink) return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(botLink);
      qr.make();
      return qr.createSvgTag({ scalable: true, margin: 2 });
    } catch {
      return null;
    }
  }, [botLink]);

  const expiresAt = code ? Date.parse(code.expires_at) : 0;
  const secondsLeft = code && Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const expired = Boolean(code) && secondsLeft === 0;

  async function copyCode() {
    try {
      if (!navigator.clipboard?.writeText || !code) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(code.code);
    } catch {
      setError('Could not copy the code.');
    }
  }

  async function sendTest() {
    setError(null);
    try {
      await client.sendTestNotification();
    } catch {
      setError('Could not send a test notification.');
    }
  }

  async function removeTarget(id: string) {
    setError(null);
    try {
      await client.removeNotificationTarget(id);
      await refreshStatus();
    } catch {
      setError('Could not remove this chat.');
    }
  }

  function connectAnother() {
    setConnectingAnother(true);
    setConnectedNotice(null);
    setCode(null);
    setError(null);
  }

  return (
    <section className="card fade-in stack" role="dialog" aria-label="Notifications"
      style={{ position: 'absolute', right: 0, top: 50, zIndex: 40, width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(80vh, 680px)', overflowY: 'auto', padding: 16, gap: 14, boxShadow: 'var(--shadow-pop)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Notifications</h2>
        <button type="button" className="btn btn-icon" aria-label="Close notifications" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>

      {!status && !error && <p className="t-small">Loading notification settings…</p>}
      {error && <p className="t-small" role="alert">{error}</p>}

      {status && status.targets.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          {connectedNotice && <p className="t-small" role="status">✅ Connected ({connectedNotice})</p>}
          <div className="stack" style={{ gap: 8 }}>
            {status.targets.map((target) => (
              <div key={target.id} className="card" style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span className="stack" style={{ minWidth: 0, gap: 3 }}>
                  <strong className="trunc">{target.display_name ?? 'Unnamed chat'}</strong>
                  <span className="t-small">{target.chat_type === 'group' ? 'Group' : 'Private'}{target.broken && ' · Needs reconnect'}</span>
                </span>
                <button type="button" className="btn" onClick={() => void removeTarget(target.id)}>Remove</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-block" onClick={() => void sendTest()}>Send test</button>
          <p className="t-small" style={{ margin: 0 }}>This month: {status.sent_this_month} / {status.monthly_limit}</p>
          {!connectingAnother && <button type="button" className="btn btn-block" onClick={connectAnother}>Connect another chat</button>}
        </div>
      )}

      {status && (status.targets.length === 0 || connectingAnother) && (
        <div className="stack" style={{ gap: 12 }}>
          {status.targets.length > 0 && <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Connect another chat</h3>}
          <div className="stack" style={{ gap: 8 }}>
            <strong>1. Open the bot</strong>
            {botLink ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {qrSvg ? <div role="img" aria-label="QR code for Zalo bot" style={{ width: 132, height: 132, flex: 'none' }} dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <p className="t-small">Could not create the QR code.</p>}
                <a className="btn" href={botLink} target="_blank" rel="noreferrer">Open in Zalo</a>
              </div>
            ) : <p className="t-small">The bot link is unavailable.</p>}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <strong>2. Send this code</strong>
            {loadingCode && <span className="t-small">Creating a code…</span>}
            {code && !expired && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong aria-label="Link code" style={{ fontSize: '1.65rem', letterSpacing: '0.16em', fontVariantNumeric: 'tabular-nums' }}>{code.code}</strong>
                  <button type="button" className="btn" onClick={() => void copyCode()}>Copy</button>
                </div>
                <span className="t-small">expires in {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</span>
              </>
            )}
            {expired && <button type="button" className="btn" onClick={() => { setCode(null); setError(null); }}>New code</button>}
          </div>
          <p className="t-small" style={{ margin: 0 }}>Works in a group too: add the bot to the group and send the code there.</p>
        </div>
      )}
    </section>
  );
}
