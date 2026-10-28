import { Link } from 'react-router-dom';
import type { Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionPath, inFlight, needsYou } from '@/state/selectors';
import { DECISION_STATUS } from '@/lib/status';
import { duration } from '@/lib/time';
import { KindChip, StatusChip } from '@/components/Chips';
import { EmptyState, SectionCard } from '@/components/ui';
import { Icon } from '@/components/Icon';

export function NeedsYouSection({ workspace }: { workspace: Workspace }) {
  const hub = useHub();
  const now = useNow(15_000);
  const needs = needsYou(hub, workspace.id);
  const flying = inFlight(hub, workspace.id);

  return (
    <SectionCard id="needs" title="Needs you" icon="bell" tone={needs.length ? 'needs' : undefined}
      right={needs.length > 0 && <span className="count">{needs.length}</span>}>
      {needs.map((d) => (
        <Link key={d.id} className="row" to={decisionPath(d)} style={{ minHeight: 64 }}>
          <span className="mono" style={{ fontWeight: 600, width: 28 }}>{d.id}</span>
          <KindChip kind={d.kind} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="trunc" style={{ fontWeight: 600 }}>{d.title}</span>
            <span className="meta">
              <span>{d.agent}{d.taskId ? ` · ${d.taskId}` : ''} · {duration(d.openedAt, now)}</span>
              {d.status !== 'OPEN' && <StatusChip look={DECISION_STATUS[d.status]} label={d.status === 'REJECTED' ? 'Rejected, fix it' : undefined} />}
            </span>
          </span>
          <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
        </Link>
      ))}
      {needs.length === 0 && (
        <EmptyState icon="check" title="Nothing needs you.">Opus asks here when a call is yours.</EmptyState>
      )}
      {flying.length > 0 && (
        <>
          <div className="t-label" style={{ borderTop: '1px solid var(--border)', padding: '8px 16px 4px' }}>Answered, on the way</div>
          {flying.map((d) => (
            <Link key={d.id} className="row" to={decisionPath(d)}>
              <span className="mono" style={{ fontWeight: 600, width: 28 }}>{d.id}</span>
              <span className="trunc" style={{ flex: 1 }}>{d.title}</span>
              <StatusChip look={DECISION_STATUS[d.status]} />
            </Link>
          ))}
        </>
      )}
    </SectionCard>
  );
}
