import { Link, useNavigate } from 'react-router-dom';
import type { Workspace } from '@/api/types';
import { useHub } from '@/state/HubProvider';
import { decisionPath, needsYou } from '@/state/selectors';
import { AGENT_STATE, RUN_STATUS, WORKSPACE_STATUS } from '@/lib/status';
import { ago } from '@/lib/time';
import { StatusChip } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { workspaceStatusLabel } from '../workspace/labels';

export const HUB_KIT_VERSION = '0.9.4';

export function WorkspaceCard({ workspace: w, now }: { workspace: Workspace; now: number }) {
  const hub = useHub();
  const navigate = useNavigate();
  const needs = needsYou(hub, w.id);
  const stopped = w.status === 'STOPPED';
  const lastRun = w.run ?? w.pastRuns[0];
  const problems = w.run?.problems ?? [];
  const noDecision = problems.filter((p) => !p.decisionId).length;
  const outdated = w.kitVersion !== HUB_KIT_VERSION;

  const openNeeds = () => navigate(needs.length === 1 ? decisionPath(needs[0]!) : `/w/${w.id}`);

  return (
    <article className={`card fade-in${stopped ? ' is-stopped' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="t-h2">
            <Link to={`/w/${w.id}`} style={{ color: stopped ? 'var(--text-2)' : 'var(--text)' }}>{w.name}</Link>
          </h2>
          <StatusChip look={WORKSPACE_STATUS[w.status]} label={workspaceStatusLabel(w, now)} />
        </div>

        {needs.length > 0 ? (
          <button type="button" className="needs-band" onClick={openNeeds}>
            <span className="needs"><Icon name="bell" />{needs.length} {needs.length === 1 ? 'needs you' : 'need you'}</span>
            <span className="trunc" style={{ fontSize: 13, flex: 1 }}>
              {needs.map((d) => `${d.id} ${d.kind}`).join(' · ')}
              {!w.computerOnline ? ' · computer offline; answers disabled' : w.status !== 'RUNNING' ? ' · answers wait for your computer' : ''}
            </span>
            <Icon name="chevron-right" style={{ color: 'var(--needs-you)' }} />
          </button>
        ) : (
          <div className="inset" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', minHeight: 44, color: 'var(--text-2)', fontSize: 13 }}>
            <Icon name="check" style={{ color: 'var(--status-done)' }} />Nothing needs you
          </div>
        )}
      </div>

      <dl className="dl-grid" style={{ padding: '0 16px 14px' }}>
        <dt>{w.run ? 'Run' : 'Last run'}</dt>
        <dd>
          <span className="mono">{lastRun?.id ?? '—'}</span>
          {lastRun && <StatusChip look={RUN_STATUS[lastRun.status]} />}
          <span className="t-3 trunc">
            {w.run ? (w.status === 'OFFLINE' || !w.computerOnline ? `as of ${ago(w.lastSeenAt, now)}` : w.run.outcome ?? '') : w.pastRuns[0]?.outcome}
          </span>
        </dd>
        <dt>Orchestrator</dt>
        <dd>
          <StatusChip look={AGENT_STATE[w.status === 'RUNNING' ? w.orchestrator.state : w.status === 'OFFLINE' ? 'unknown' : 'off']} />
          {w.status === 'RUNNING' && <span className="t-2">{ago(w.orchestrator.lastActivityAt, now)}</span>}
          {!w.computerOnline && <span className="t-2">computer offline</span>}
          {w.computerOnline && w.status === 'OFFLINE' && <span className="t-2">no heartbeat</span>}
        </dd>
        <dt>Problems</dt>
        <dd>
          {problems.length ? (
            <>
              <span className="chip c-review"><Icon name="alert" />{problems.length} {problems.length === 1 ? 'problem' : 'problems'}</span>
              <span className="t-2 trunc">{noDecision ? `${noDecision} without a decision` : 'all have decisions'}</span>
            </>
          ) : (
            <span className="chip c-done"><Icon name="check" />None</span>
          )}
        </dd>
      </dl>

      <div className="hr" />
      <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {outdated && (
          <div className="meta">
            <Icon name="package" size="sm" style={{ color: 'var(--status-review)' }} />
            <span>Kit outdated: {w.kitVersion}, hub expects {HUB_KIT_VERSION}. Run <code className="mono">agent-kit update</code>.</span>
          </div>
        )}
        <div className="meta">
          {w.status === 'RUNNING' && w.computerOnline && <span className="mono">{w.run?.integrationBranch}</span>}
          {!w.computerOnline && <span>Computer offline. Data may be stale; answers and prompts are disabled.</span>}
          {w.computerOnline && w.status === 'OFFLINE' && <span>Workspace offline until it reconnects. Prompts are off.</span>}
          {w.status === 'STOPPED' && <span>Documents and history stay readable.</span>}
        </div>
      </div>
    </article>
  );
}
