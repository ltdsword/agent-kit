import { Link } from 'react-router-dom';
import type { Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionPath, needsYou } from '@/state/selectors';
import { AGENT_STATE } from '@/lib/status';
import { ago } from '@/lib/time';
import { StatusChip } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { TerminalTail } from '@/components/ui';
import { PromptComposer } from '../prompts/PromptComposer';

export function OrchestratorCard({ workspace: w }: { workspace: Workspace }) {
  const hub = useHub();
  const now = useNow(15_000);
  const running = w.status === 'RUNNING';
  const state = running ? w.orchestrator.state : w.status === 'OFFLINE' ? 'unknown' : 'off';
  const ownDecisions = needsYou(hub, w.id).filter((d) => d.agent === 'orchestrator');

  return (
    <section className="card" aria-labelledby="orch-h">
      <div className="stack" style={{ padding: 16, gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span className="doc-ico" style={{ width: 40, height: 40, color: 'var(--text)' }}><Icon name="hub" size="lg" /></span>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <h2 id="orch-h" className="t-h2">Orchestrator</h2>
            <span className="meta">
              <span>{w.orchestrator.program}</span><span className="sep" /><span>{w.orchestrator.model}</span><span className="sep" /><span>{w.orchestrator.effort} effort</span>
            </span>
          </div>
          <div className="stack" style={{ marginLeft: 'auto', alignItems: 'flex-end', gap: 4 }}>
            <StatusChip look={AGENT_STATE[state]} />
            <span className="t-small">last activity {ago(w.orchestrator.lastActivityAt, now)}</span>
          </div>
        </div>

        {ownDecisions.map((d) => (
          <Link key={d.id} className="needs-band" to={decisionPath(d)}>
            <span className="chip c-needs"><Icon name="bell" />Needs you</span>
            <span className="mono" style={{ fontWeight: 600 }}>{d.id}</span>
            <span className="trunc" style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{d.title}</span>
            <Icon name="chevron-right" />
          </Link>
        ))}

        {running && w.uploads.orchestratorScreen && w.orchestrator.screen && (
          <TerminalTail title="Screen · last lines" text={w.orchestrator.screen} hint="expand" />
        )}

        <PromptComposer workspace={w} />
      </div>
    </section>
  );
}
