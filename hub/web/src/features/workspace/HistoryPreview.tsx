import { Link } from 'react-router-dom';
import type { Workspace } from '@/api/types';
import { useHub } from '@/state/HubProvider';
import { Icon } from '@/components/Icon';
import { HistoryRow } from '../history/HistoryRow';

export function HistoryPreview({ workspace: w }: { workspace: Workspace }) {
  const hub = useHub();
  const entries = hub.history.filter((e) => e.workspaceId === w.id).slice(0, 3);
  return (
    <section className="card" aria-labelledby="hp-h" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h2 id="hp-h" className="t-h2">History</h2>
        <Link to={`/w/${w.id}/history`} style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32 }}>
          Open timeline<Icon name="chevron-right" size="sm" />
        </Link>
      </div>
      {entries.map((e) => <HistoryRow key={e.id} entry={e} compact />)}
    </section>
  );
}
