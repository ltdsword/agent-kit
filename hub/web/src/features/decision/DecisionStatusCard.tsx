import type { Decision, Workspace } from '@/api/types';
import { useNow } from '@/state/HubProvider';
import { ago, hhmm } from '@/lib/time';
import { Stepper, type Step } from '@/components/ui';

function stepsFor(d: Decision): Step[] | null {
  switch (d.status) {
    case 'SENT': return [{ label: 'Sent', state: 'cur', icon: 'send' }, { label: 'Delivered to your computer', state: 'todo' }, { label: 'Applied', state: 'todo' }];
    case 'WAITING': return [{ label: 'Waiting for your computer', state: 'wait', icon: 'clock' }, { label: 'Delivered', state: 'todo' }, { label: 'Applied', state: 'todo' }];
    case 'DELIVERED': return [{ label: 'Sent', state: 'done', icon: 'check' }, { label: 'Delivered to your computer', state: 'done', icon: 'check' }, { label: 'Applied', state: 'cur' }];
    case 'APPLIED': return [{ label: 'Sent', state: 'done', icon: 'check' }, { label: 'Delivered to your computer', state: 'done', icon: 'check' }, { label: 'Applied', state: 'done', icon: 'check' }];
    case 'REJECTED': return [{ label: 'Sent', state: 'done', icon: 'check' }, { label: 'Rejected', state: 'bad', icon: 'alert' }];
    default: return null;
  }
}

/** What happened after an answer: stepper + plain-language status. Replaces the form once it is answered. */
export function DecisionStatusCard({ decision: d, workspace: w }: { decision: Decision; workspace: Workspace }) {
  const now = useNow(15_000);
  const steps = stepsFor(d);
  const a = d.answer;

  const text: Partial<Record<Decision['status'], string>> = {
    SENT: `Sent at ${a ? hhmm(a.at) : ''}. Waiting for your computer to pick it up.`,
    WAITING: `${w.name} is offline (last seen ${ago(w.lastSeenAt, now)}). Your answer is saved and goes out when it reconnects.`,
    DELIVERED: `Recorded on your computer${d.deliveredAt ? ` at ${hhmm(d.deliveredAt)}` : ''} and typed to Opus. Final now.`,
    APPLIED: `${d.appliedNote ?? 'Opus acted on it.'}${d.appliedAt ? ` (${hhmm(d.appliedAt)})` : ''}`,
    ANSWERED_ELSEWHERE: `You answered in the terminal${a ? ` at ${hhmm(a.at)}` : ''}. Read-only.`,
    CANCELLED: `Opus withdrew ${d.id}: “${d.cancelReason ?? ''}”`,
  };

  return (
    <section className="card fade-in stack" style={{ padding: 14, gap: 12 }} aria-live="polite">
      {steps && <Stepper steps={steps} label="Delivery status" />}
      {a && d.status !== 'REJECTED' && (
        <div style={{ fontSize: 14 }}>
          <strong>{a.choice}</strong> · {a.label}
          {(a.branch || a.note) && (
            <span className="t-2"> · {[a.branch && `into ${a.branch}${a.push ? ', push' : ''}`, a.note && `note: ${a.note}`].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      )}
      {a?.quote && d.status !== 'REJECTED' && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="t-label">Your words</span>
          <span className="quote" style={{ margin: 0 }}>“{a.quote}”</span>
        </div>
      )}
      {text[d.status] && <p style={{ fontSize: 13.5 }}>{text[d.status]}</p>}
    </section>
  );
}
