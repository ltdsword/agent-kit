import { Link } from 'react-router-dom';
import type { Workspace, Worker } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionPath, needsYou } from '@/state/selectors';
import { TASK_STATUS, WORKER_STATUS } from '@/lib/status';
import { duration } from '@/lib/time';
import { PlainChip, StatusChip } from '@/components/Chips';
import { Icon, type IconName } from '@/components/Icon';
import { TerminalTail } from '@/components/ui';

const LIVE: Record<Worker['live'], { color: string; icon: IconName; label: string }> = {
  working: { color: 'var(--status-running)', icon: 'activity', label: 'working' },
  idle: { color: 'var(--text-2)', icon: 'pause', label: 'idle' },
  blocked: { color: 'var(--status-blocked)', icon: 'octagon', label: 'blocked on terminal prompt' },
  unknown: { color: 'var(--text-3)', icon: 'unknown', label: 'unknown, no heartbeat' },
  off: { color: 'var(--text-3)', icon: 'power', label: 'not running' },
};

export function SubagentsSection({ workspace: w }: { workspace: Workspace }) {
  return (
    <section aria-labelledby="sub-h" className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 id="sub-h" className="t-h2">Subagents</h2>
        <span className="t-small">{w.workers.length} worker{w.workers.length === 1 ? '' : 's'}{w.scout ? ' · 1 scout' : ''}</span>
      </div>
      {w.workers.length === 0 && <div className="card card-pad t-2">No workers in use.</div>}
      <div className="grid-workers">
        {w.workers.map((k) => <WorkerCard key={k.slot} workspace={w} worker={k} />)}
      </div>
      {w.scout && <ScoutCard workspace={w} />}
    </section>
  );
}

function WorkerCard({ workspace: w, worker: k }: { workspace: Workspace; worker: Worker }) {
  const hub = useHub();
  const now = useNow(15_000);
  const task = w.run?.tasks.find((t) => t.id === k.taskId);
  const live = LIVE[w.status === 'RUNNING' ? k.live : 'unknown'];
  const decision = needsYou(hub, w.id).find((d) => d.agent === k.slot);

  return (
    <article className="card stack" style={{ padding: 14, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="cpu" style={{ color: 'var(--text-2)' }} />
        <span className="mono" style={{ fontWeight: 600 }}>{k.slot}</span>
        <span style={{ marginLeft: 'auto' }}><StatusChip look={WORKER_STATUS[k.status]} /></span>
      </div>
      {task && (
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontWeight: 600 }}><span className="mono">{task.id}</span> {task.title}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <StatusChip look={TASK_STATUS[task.status]} mono />
            {task.fixRound && <PlainChip>fix {task.fixRound}</PlainChip>}
          </div>
        </div>
      )}
      <div className="meta">
        <span className="live" style={{ color: live.color }}><Icon name={live.icon} size="sm" />{live.label}</span>
        <span className="sep" /><span>{duration(k.sinceAt, now)}</span>
        {k.model && <><span className="sep" /><span>{k.model}</span></>}
      </div>
      {k.screen && w.uploads.agentScreens && w.status === 'RUNNING' && (
        <TerminalTail title="Screen" text={k.screen} defaultOpen={k.live === 'blocked'} />
      )}
      {decision && (
        <Link className="needs-band" to={decisionPath(decision)} style={{ padding: '10px 12px', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip c-needs"><Icon name="bell" />Needs you</span>
            <span className="mono" style={{ fontWeight: 600 }}>{decision.id}</span>
            <span className="t-small" style={{ marginLeft: 'auto' }}>{duration(decision.openedAt, now)}</span>
          </span>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{decision.title}</span>
          <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            Answer {decision.id}<Icon name="chevron-right" size="sm" />
          </span>
        </Link>
      )}
    </article>
  );
}

function ScoutCard({ workspace: w }: { workspace: Workspace }) {
  const s = w.scout!;
  return (
    <article className="card stack" style={{ padding: '14px 16px', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="compass" style={{ color: 'var(--routine)' }} />
        <span className="mono" style={{ fontWeight: 600 }}>scout</span>
        <span className="t-small">read-only</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <PlainChip>Research {s.roundsUsed}/{s.maxRounds}</PlainChip>
          {s.ready
            ? <span className="chip c-done"><Icon name="check" />Ready</span>
            : <span className="chip c-review"><Icon name="clock" />Not ready</span>}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
        {s.rounds.map((r) => (
          <div key={r.name} className="inset stack" style={{ padding: 12, gap: 6 }}>
            <span className="t-label">{r.name}</span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
              {r.questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
            <Link to={`/w/${w.id}/docs/${r.docId}`} style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 32 }}>
              <Icon name="file" size="sm" />Research dossier
            </Link>
          </div>
        ))}
      </div>
    </article>
  );
}
