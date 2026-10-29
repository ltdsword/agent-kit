import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DecisionStatus } from '@/api/types';
import { useClient, useHub, useNow } from '@/state/HubProvider';
import { findDecision, workspaceById } from '@/state/selectors';
import { DECISION_STATUS, NEEDS_YOU } from '@/lib/status';
import { ago, hhmm } from '@/lib/time';
import { KindChip, StatusChip } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';
import { useDecisionForm } from './useDecisionForm';
import { DecisionForm } from './DecisionForm';
import { DecisionContext } from './DecisionContext';
import { DecisionStatusCard } from './DecisionStatusCard';
import { ConfirmSheet } from './ConfirmSheet';

const ERRORS: Record<string, string> = {
  hub_unreachable: 'The hub can’t be reached. Nothing was sent.',
  computer_offline: 'The computer is offline. Nothing was sent.',
  decision_not_open: 'This decision is no longer open. Nothing was sent.',
  decision_not_answerable: 'This decision was already answered or closed, so nothing new was sent. The page now shows its current status.',
  workspace_stopped: 'This workspace isn’t running. Nothing was sent.',
  answer_unconfirmed: 'The connection dropped and the answer could not be confirmed. Check the decision status, then send again if it is still open.',
};

const INTERRUPTED: Partial<Record<DecisionStatus, (id: string, t: string) => string>> = {
  CANCELLED: (id, t) => `Opus cancelled ${id} at ${t} while you were reading. Nothing was sent.`,
  ANSWERED_ELSEWHERE: (id) => `You answered ${id} in the terminal while this was open. The form closed.`,
};

export function DecisionPage() {
  const { wsId, runId, decId } = useParams();
  const hub = useHub();
  const client = useClient();
  const now = useNow(15_000);
  const d = findDecision(hub, wsId, runId, decId);
  const w = workspaceById(hub, wsId);
  const form = useDecisionForm(d);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interrupt, setInterrupt] = useState<string | null>(null);

  // Detect the decision changing under the user (Opus cancels it, terminal answer, superseded).
  const prevStatus = useRef(d?.status);
  const ownAction = useRef(false);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = d?.status;
    if (!d || !prev || prev === d.status) return;
    if (NEEDS_YOU.has(prev) && !NEEDS_YOU.has(d.status) && !ownAction.current) {
      const msg = INTERRUPTED[d.status]?.(d.id, hhmm(Date.now()));
      if (msg) { setInterrupt(msg); setConfirm(false); }
    }
    ownAction.current = false;
  }, [d]);

  const back = useCallback(() => setConfirm(false), []);
  if (!d || !w) return <div className="page page-narrow"><h1 className="t-h1">Decision not found</h1><Link to="/">Back to workspaces</Link></div>;

  const open = NEEDS_YOU.has(d.status);
  const lost = hub.connection === 'lost';
  const computerOffline = !w.computerOnline;

  const run = async (fn: () => Promise<void>) => {
    setError(null); setBusy(true); ownAction.current = true;
    try { await fn(); } catch (e) { ownAction.current = false; setError(ERRORS[(e as Error).message] ?? (e as Error).message); }
    finally { setBusy(false); }
  };
  const send = () => run(async () => { await client.answerDecision(d.workspaceId, d.runId, d.id, form.toInput()); setConfirm(false); });
  const reply = () => run(async () => { await client.replyToDecision(d.workspaceId, d.runId, d.id, form.chatText.trim()); form.clearChat(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  const reviewLabel = !form.picked ? 'Choose an option'
    : d.kind === 'finish' ? ({ A: 'Review: merge and push', B: 'Review: merge locally', C: 'Review: don’t merge' } as Record<string, string>)[form.picked] ?? 'Review answer'
    : d.kind === 'worker_approval' ? (form.picked === 'A' ? 'Review: approve once' : 'Review: deny')
    : `Review answer ${form.picked}`;
  const status = DECISION_STATUS[d.status];

  return (
    <div className="fade-in stack" style={{ width: '100%', maxWidth: 720, margin: '0 auto', flex: 1 }}>
      <div style={{ padding: '10px 8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link className="btn btn-ghost btn-sm" to={`/w/${w.id}`} style={{ minHeight: 44 }}><Icon name="chevron-left" />{w.name}</Link>
        <span className="t-small" style={{ marginLeft: 'auto', paddingRight: 8 }}>{d.runId === 'inbox' ? <>Question <span className="mono">{d.id.replace(/^D/, 'Q')}</span></> : <>Decision <span className="mono">{d.id}</span> · run {d.runId}</>}</span>
      </div>

      <div className="stack" style={{ padding: '10px 16px 24px', gap: 18, flex: 1 }}>
        {interrupt && (
          <Banner tone="needs" icon="alert" role="alert"
            action={<button type="button" className="btn btn-icon" aria-label="Dismiss" onClick={() => setInterrupt(null)} style={{ width: 36, minHeight: 36 }}><Icon name="x" /></button>}>
            {interrupt}
          </Banner>
        )}

        <header className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <KindChip kind={d.kind} />
            <StatusChip look={status} />
            <span className="t-small" style={{ marginLeft: 'auto' }}>opened {ago(d.openedAt, now)}</span>
          </div>
          <div className="meta">
            <span>About</span><span className="mono" style={{ color: 'var(--text)' }}>{d.agent}</span>
            {d.taskId && <><span className="sep" /><span className="mono" style={{ color: 'var(--text)' }}>{d.taskId}</span>
              <span>{w.run?.tasks.find((t) => t.id === d.taskId)?.title}</span></>}
          </div>
          <h1 style={{ fontSize: 22, lineHeight: 1.3, fontWeight: 600, letterSpacing: '-.01em' }}>{d.title}</h1>
        </header>

        <DecisionContext decision={d} />

        {(!open || d.status === 'REJECTED' || d.status === 'REPLY_SENT') && <DecisionStatusCard decision={d} workspace={w} />}
        {d.status === 'REJECTED' && (
          <Banner tone="error" icon="alert" role="alert">
            <strong>Your computer refused the answer.</strong> {d.rejectReason} Nothing was applied. Fix it below and send again.
          </Banner>
        )}
        {error && <Banner tone="error" icon="alert" role="alert">{error}</Banner>}
        {computerOffline && <Banner tone="stale" icon="wifi-off" role="status">Computer offline. Answers and replies are disabled until it reconnects.</Banner>}

        {open && <DecisionForm decision={d} workspace={w} form={form} />}
      </div>

      {open && (
        <footer className="sticky-footer">
          {lost && <span className="t-small" style={{ textAlign: 'center' }}>Hub connection lost. Sending resumes when it’s back.</span>}
          {!lost && d.kind === 'finish' && form.branch && form.picked !== 'C' && (
            <span className="t-small" style={{ textAlign: 'center' }}>Merge {d.runId} into {form.branch}{form.picked === 'A' ? ', then push' : ', no push'}</span>
          )}
          {computerOffline && <span className="t-small" style={{ textAlign: 'center' }}>Computer offline. Answers are disabled.</span>}
          {form.chatOpen ? (
            <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 48, fontSize: 15 }} disabled={!form.canReply || lost || computerOffline || busy} onClick={() => void reply()}>
              <Icon name="send" />Send reply to Opus
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 48, fontSize: 15 }} disabled={!form.canReview || lost || computerOffline} onClick={() => setConfirm(true)}>
              <Icon name="arrow-right" />{reviewLabel}
            </button>
          )}
        </footer>
      )}

      {confirm && open && <ConfirmSheet decision={d} workspace={w} form={form} busy={busy} onSend={() => void send()} onBack={back} />}
    </div>
  );
}
