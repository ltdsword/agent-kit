import type { Decision, Workspace } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';
import { OptionCard, orderOptions } from './OptionCard';
import type { DecisionFormState } from './useDecisionForm';

/** Options + optional note + "Chat something…" + (finish) branch step. Presentational: state comes from useDecisionForm. */
export function DecisionForm({ decision: d, workspace: w, form: f }: { decision: Decision; workspace: Workspace; form: DecisionFormState }) {
  const isFinish = d.kind === 'finish';
  return (
    <>
      {w.status !== 'RUNNING' && (
        <Banner icon="wifi-off" role="status">{w.name} is offline. You can answer now; it’s delivered when your computer reconnects.</Banner>
      )}
      {d.status === 'REPLY_SENT' && (
        <Banner tone="info" icon="message" role="status">
          <strong>Reply sent.</strong> “{d.replyText}” Opus records it as your answer or asks again. You can still pick an option.
        </Banner>
      )}
      {d.opusNote && (
        <div className="inset" style={{ padding: '10px 12px', display: 'flex', gap: 10, fontSize: 13.5 }}>
          <Icon name="hub" style={{ color: 'var(--text-2)', marginTop: 2 }} />
          <span><strong>Opus:</strong> {d.opusNote}</span>
        </div>
      )}

      <fieldset className="opts">
        <legend style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {isFinish && <StepNumber n={1} />}
          <span className={isFinish ? 't-h2' : 't-label'}>{isFinish ? `Merge run ${d.runId}?` : 'Your answer'}</span>
        </legend>
        {orderOptions(d.options, d.recommend).map((o) => (
          <OptionCard key={o.key} name={`answer-${d.id}`} option={o} recommended={o.key === d.recommend} selected={f.picked === o.key} onSelect={() => f.pick(o.key)} />
        ))}
      </fieldset>

      {f.needsBranch && <BranchStep form={f} />}

      {isFinish && f.picked === 'A' && (
        <Banner tone="info" icon="upload">
          <strong>Push is the one step you can’t take back from here.</strong> Once it reaches <span className="mono">origin/{f.branch || '…'}</span>, others can pull it. The kit never force-pushes.
        </Banner>
      )}

      {f.picked && !f.chatOpen && (
        <div className="fade-in">
          <label className="field-label" htmlFor={`note-${d.id}`}>
            Note for Opus <span className="t-3" style={{ fontWeight: 400 }}>· optional, sent with {f.picked}</span>
          </label>
          <input id={`note-${d.id}`} className="field" type="text" value={f.note} onChange={(e) => f.setNote(e.target.value)} placeholder="e.g. keep T1’s error message text" />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-hidden="true">
        <span className="hr" style={{ flex: 1 }} /><span className="t-small">or</span><span className="hr" style={{ flex: 1 }} />
      </div>

      {f.chatOpen ? (
        <div className="card fade-in stack" style={{ padding: 12, gap: 8, borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="message" style={{ color: 'var(--accent)' }} />
            <label htmlFor={`chat-${d.id}`} style={{ fontWeight: 600, fontSize: 14 }}>Reply to Opus instead</label>
            <button type="button" className="btn btn-icon" aria-label="Close reply" onClick={f.closeChat} style={{ marginLeft: 'auto', marginRight: -10 }}><Icon name="x" /></button>
          </div>
          <textarea id={`chat-${d.id}`} className="field" value={f.chatText} onChange={(e) => f.setChatText(e.target.value)} placeholder="Opus records it as your answer, or asks again." autoFocus />
          <p className="hint"><Icon name="info" />Goes to Opus as your words. {d.id} stays open until Opus records an answer.</p>
        </div>
      ) : (
        <button type="button" className="chat-toggle" onClick={f.openChat}>
          <Icon name="message" />Chat something…<span className="t-small" style={{ marginLeft: 'auto', fontWeight: 400 }}>in your own words</span>
        </button>
      )}

      <p className="hint" style={{ marginTop: 0 }}><Icon name="lock" />Answers are final once delivered to your computer. To change one later, Opus opens a new decision.</p>
    </>
  );
}

function StepNumber({ n }: { n: number }) {
  return <span className="count" style={{ background: 'var(--text)', color: 'var(--bg)' }}>{n}</span>;
}

function BranchStep({ form: f }: { form: DecisionFormState }) {
  const showErr = f.branchMode === 'other' && f.branchText.length > 0 && f.branchError;
  return (
    <fieldset className="opts fade-in">
      <legend style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <StepNumber n={2} /><span style={{ fontWeight: 600, fontSize: 16 }}>Which branch?</span>
      </legend>
      {f.thisBranch && <label className={`opt${f.branchMode === 'this' ? ' sel' : ''}`} style={{ alignItems: 'center' }}>
        <input type="radio" name="branch" value="this" checked={f.branchMode === 'this'} onChange={() => f.setBranchMode('this')} />
        <Icon name="branch" size="lg" style={{ color: 'var(--text-2)' }} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span className="lbl">This branch (<span className="mono">{f.thisBranch}</span>)</span>
          <span className="cons">The branch the run started from.</span>
        </span>
        <span className="radio" aria-hidden="true" />
      </label>}
      <label className={`opt${f.branchMode === 'other' ? ' sel' : ''}`}>
        <input type="radio" name="branch" value="other" checked={f.branchMode === 'other'} onChange={() => f.setBranchMode('other')} />
        <Icon name="branch" size="lg" style={{ color: 'var(--text-2)', marginTop: 4 }} />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span className="lbl">Another branch</span>
          <span className="cons">Type its name.</span>
        </span>
        <span className="radio" aria-hidden="true" />
      </label>
      {f.branchMode === 'other' && (
        <div className="fade-in">
          <label className="field-label" htmlFor="branch-name">Branch name</label>
          <input id="branch-name" className={`field mono${showErr ? ' err' : ''}`} type="text" value={f.branchText}
            onChange={(e) => f.setBranchText(e.target.value)} placeholder="release/user-validation"
            autoComplete="off" spellCheck={false} aria-invalid={!!showErr} aria-describedby="branch-hint" />
          {showErr ? (
            <p id="branch-hint" className="err-text"><Icon name="alert" size="sm" />{f.branchError}</p>
          ) : (
            <p id="branch-hint" className="hint"><Icon name="info" />
              {f.branchText.trim() ? `New name: the branch is created from ${f.thisBranch ?? 'the base branch'}.` : 'An existing branch, or a new name to create it.'} agent/ branches aren’t allowed.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
