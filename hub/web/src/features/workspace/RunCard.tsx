import { Link } from 'react-router-dom';
import type { Task, Workspace } from '@/api/types';
import { GATE_STATUS, RUN_STATUS, TASK_STATUS } from '@/lib/status';
import { PlainChip, StatusChip } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';

const NODE_CLASS: Partial<Record<Task['status'], string>> = {
  RUNNING: 'n-run', FIX_REQUIRED: 'n-fix', BLOCKED: 'n-blocked', FAILED: 'n-blocked', PENDING: 'n-pending', PASSED: 'n-done', MERGED: 'n-done',
};

export function RunCard({ workspace: w }: { workspace: Workspace }) {
  const run = w.run;
  return (
    <section className="card" aria-labelledby="runs-h">
      <div className="stack" style={{ padding: 16, gap: 14 }}>
        {run ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 id="runs-h" className="t-h2">Run <span className="mono">{run.id}</span></h2>
              <StatusChip look={RUN_STATUS[run.status]} />
            </div>
            {run.outcome && <Banner tone="info" icon="merge">{run.outcome}</Banner>}
            <dl className="dl-grid" style={{ gridTemplateColumns: '70px minmax(0, 1fr)', fontSize: 13 }}>
              <dt>Branch</dt><dd className="mono"><Icon name="branch" size="sm" />{run.integrationBranch}</dd>
              <dt>Gate</dt><dd><StatusChip look={GATE_STATUS[run.gate]} /></dd>
            </dl>
            <TaskGraph tasks={run.tasks} />
            {run.problems.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="t-label">Problems</span>
                {run.problems.map((p) => (
                  <Banner key={p.text} tone={p.severity === 'warn' ? 'stale' : 'error'} icon={p.severity === 'warn' ? 'alert' : 'octagon'}
                    action={p.decisionId ? <Link to={`/w/${w.id}/d/${run.id}/${p.decisionId}`} style={{ fontWeight: 600 }}>{p.decisionId} open</Link> : undefined}>
                    <strong>{p.text}</strong> {p.note}
                  </Banner>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 id="runs-h" className="t-h2">Runs</h2>
            <p className="t-2">No active run.</p>
          </>
        )}
        {w.pastRuns.length > 0 && (
          <details style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            <summary style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer', fontWeight: 600, fontSize: 13.5, listStyle: 'none' }}>
              <Icon name="chevron-down" />Past runs<span className="count count-quiet">{w.pastRuns.length}</span>
            </summary>
            {w.pastRuns.map((p) => (
              <div key={p.id} className="row" style={{ padding: '8px 0', minHeight: 44 }}>
                <span className="mono" style={{ width: 24 }}>{p.id}</span>
                <StatusChip look={RUN_STATUS[p.status]} />
                <span className="trunc t-2" style={{ flex: 1, fontSize: 13 }}>{p.outcome}</span>
                <span className="t-small">{p.date}</span>
              </div>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}

/** Small task graph: tasks with no dependencies first, then dependents with "needs T1, T2". */
function TaskGraph({ tasks }: { tasks: Task[] }) {
  const roots = tasks.filter((t) => t.dependsOn.length === 0);
  const dependents = tasks.filter((t) => t.dependsOn.length > 0);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="t-label">Tasks</span>
      <div style={{ display: 'grid', gridTemplateColumns: dependents.length ? 'minmax(0, 1fr) 20px minmax(0, 0.85fr)' : 'minmax(0, 1fr)', alignItems: 'center' }}>
        <div className="stack" style={{ gap: 8 }}>{roots.map((t) => <TaskNode key={t.id} task={t} />)}</div>
        {dependents.length > 0 && (
          <>
            <div aria-hidden="true" style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border-strong)' }}>
              <Icon name="chevron-right" />
            </div>
            <div className="stack" style={{ gap: 8 }}>{dependents.map((t) => <TaskNode key={t.id} task={t} />)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskNode({ task: t }: { task: Task }) {
  return (
    <div className={`node ${NODE_CLASS[t.status] ?? ''}`}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="nid">{t.id}</span>
        <span className="trunc" style={{ fontSize: 13, flex: 1 }}>{t.title}</span>
        {t.worker && t.status !== 'MERGED' && <span className="t-small mono">{t.worker}</span>}
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusChip look={TASK_STATUS[t.status]} mono />
        {t.fixRound && t.status !== 'MERGED' && <PlainChip>fix {t.fixRound}</PlainChip>}
        {t.dependsOn.length > 0 && t.status === 'PENDING' && <span className="t-small">needs {t.dependsOn.join(', ')}</span>}
      </span>
    </div>
  );
}
