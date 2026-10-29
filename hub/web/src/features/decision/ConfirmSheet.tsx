import { useEffect, useRef } from 'react';
import type { Decision, Workspace } from '@/api/types';
import { Icon } from '@/components/Icon';
import type { DecisionFormState } from './useDecisionForm';

/** Repeats the choice before sending, because an answer is final once delivered. */
export function ConfirmSheet({ decision: d, workspace: w, form: f, busy, onSend, onBack }: {
  decision: Decision; workspace: Workspace; form: DecisionFormState; busy: boolean; onSend: () => void; onBack: () => void;
}) {
  const sendRef = useRef<HTMLButtonElement>(null);
  const opt = d.options.find((o) => o.key === f.picked);
  const online = w.status === 'RUNNING';

  useEffect(() => {
    sendRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  if (!opt) return null;
  return (
    <div className="overlay">
      <div className="scrim" />
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-h">
        <div className="grab" aria-hidden="true" />
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="confirm-h" style={{ fontSize: 19, fontWeight: 600 }}>Send answer to {d.id}?</h2>
          <p className="t-2" style={{ fontSize: 13.5 }}>{d.title}</p>
        </div>
        <div className="opt sel" style={{ cursor: 'default' }}>
          <span className="key">{opt.key}</span>
          <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span className="lbl">{opt.label}</span>
            <span className="cons">{opt.consequence}</span>
          </span>
        </div>
        {f.branch && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <Icon name="branch" />Into <span className="mono" style={{ fontWeight: 600 }}>{f.branch}</span>
            {opt.key === 'A' && d.kind === 'finish' && <span className="t-2">, then push to <span className="mono">origin</span></span>}
          </div>
        )}
        {f.note.trim() && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="t-label">Your note</span>
            <span className="quote" style={{ margin: 0 }}>“{f.note.trim()}”</span>
          </div>
        )}
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: '10px 8px', fontSize: 13.5, alignItems: 'start' }}>
          <dt style={{ color: 'var(--text-3)' }}><Icon name={online ? 'laptop' : 'wifi-off'} /></dt>
          <dd style={{ margin: 0 }}>{!w.computerOnline ? 'Computer offline. You can’t send an answer until it reconnects.' : online ? `Goes to ${w.name} on your computer, which is online now.` : `${w.name} is offline. The answer is saved and delivered when it reconnects.`}</dd>
          <dt style={{ color: 'var(--text-3)' }}><Icon name="lock" /></dt>
          <dd style={{ margin: 0 }}>Final once delivered. To change it, Opus has to open a new decision.</dd>
        </dl>
        <div className="stack" style={{ gap: 8, paddingTop: 4 }}>
          <button ref={sendRef} type="button" className="btn btn-primary btn-block" style={{ minHeight: 48, fontSize: 15 }} disabled={busy || !w.computerOnline} onClick={onSend}>
            <Icon name="send" />{busy ? 'Sending… (checking delivery)' : `Send answer ${opt.key}`}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>Back</button>
        </div>
      </section>
    </div>
  );
}
