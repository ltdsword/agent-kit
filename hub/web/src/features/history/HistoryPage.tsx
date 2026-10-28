import { Fragment, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { HistoryEntry } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { workspaceById } from '@/state/selectors';
import { dayLabel } from '@/lib/time';
import { Icon, type IconName } from '@/components/Icon';
import { Crumbs } from '@/components/ui';
import { HistoryRow, viewHistory } from './HistoryRow';

type Kind = HistoryEntry['type'];
const FILTERS: { kind: Kind; label: string; icon: IconName }[] = [
  { kind: 'answer', label: 'My answers', icon: 'check' },
  { kind: 'prompt', label: 'Prompts', icon: 'message' },
  { kind: 'routine', label: 'Opus routine calls', icon: 'hub' },
];

export function HistoryPage() {
  const { wsId } = useParams();
  const hub = useHub();
  const now = useNow(60_000);
  const w = workspaceById(hub, wsId);
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ answer: true, prompt: false, routine: true });
  const [run, setRun] = useState('all');
  const [query, setQuery] = useState('');

  const all = useMemo(() => hub.history.filter((e) => e.workspaceId === wsId), [hub.history, wsId]);
  const runs = useMemo(() => [...new Set(all.map((e) => e.runId).filter(Boolean))], [all]);
  const q = query.trim().toLowerCase();
  const rows = all.filter((e) => kinds[e.type] && (run === 'all' || e.runId === run) && (!q || viewHistory(e, hub).search.includes(q)));

  if (!w) return null;
  return (
    <div className="page page-mid fade-in" style={{ paddingTop: 16, gap: 16 }}>
      <Crumbs items={[{ label: 'Workspaces', to: '/' }, { label: w.name, to: `/w/${w.id}` }, { label: 'History' }]} />
      <h1 className="t-h1">History</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {FILTERS.map((f) => (
          <button key={f.kind} type="button" className="seg" aria-pressed={kinds[f.kind]} style={{ minHeight: 44 }}
            onClick={() => setKinds((k) => ({ ...k, [f.kind]: !k[f.kind] }))}>
            <Icon name={f.icon} size="sm" />{f.label}
          </button>
        ))}
        <label htmlFor="hist-run" className="sr-only">Run</label>
        <select id="hist-run" className="field" value={run} onChange={(e) => setRun(e.target.value)} style={{ width: 'auto', minWidth: 120 }}>
          <option value="all">All runs</option>
          {runs.map((r) => <option key={r} value={r}>Run {r}</option>)}
        </select>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <label htmlFor="hist-q" className="sr-only">Search history</label>
          <Icon name="search" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--text-3)' }} />
          <input id="hist-q" className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search words, ids, commands" style={{ paddingLeft: 36 }} />
        </div>
      </div>

      <div className="card" style={{ padding: '4px 16px 8px' }}>
        {rows.map((e, i) => {
          const day = dayLabel(e.at, now);
          const prev = rows[i - 1];
          const showDay = !prev || dayLabel(prev.at, now) !== day;
          return (
            <Fragment key={e.id}>
              {showDay && <div className="t-label" style={{ padding: '14px 0 6px' }}>{day}</div>}
              <HistoryRow entry={e} />
            </Fragment>
          );
        })}
        {rows.length === 0 && <p className="t-2" style={{ padding: '24px 0' }}>Nothing matches these filters.</p>}
        <p className="t-small" style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)' }}>
          Older events were trimmed on your computer (the last 500 per run are kept).
        </p>
      </div>
    </div>
  );
}
