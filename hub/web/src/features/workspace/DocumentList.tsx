import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentKind, Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionForDocument, decisionPath } from '@/state/selectors';
import { ago, formatBytes } from '@/lib/time';
import { Icon, type IconName } from '@/components/Icon';

export const DOC_KIND: Record<DocumentKind, { icon: IconName; className: string; label: string }> = {
  final_report: { icon: 'file', className: 'report', label: 'Final report' },
  final_diff: { icon: 'diff', className: 'diff', label: 'Total diff' },
  decision: { icon: 'bell', className: 'decision', label: 'Decision record' },
  research: { icon: 'compass', className: 'research', label: 'Research dossier' },
};

type Filter = 'Docs' | 'Diffs' | 'Decisions';
const FILTERS: { label: Filter; icon: IconName; kinds: DocumentKind[] }[] = [
  { label: 'Docs', icon: 'file', kinds: ['final_report', 'research'] },
  { label: 'Diffs', icon: 'diff', kinds: ['final_diff'] },
  { label: 'Decisions', icon: 'bell', kinds: ['decision'] },
];

export function DocumentList({ workspace: w }: { workspace: Workspace }) {
  const hub = useHub();
  const now = useNow(60_000);
  const [enabled, setEnabled] = useState<Record<Filter, boolean>>({ Docs: true, Diffs: true, Decisions: true });
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const available = hub.documents.filter((document) => document.workspaceId === w.id);
  const docs = available
    .filter((document) => FILTERS.some((filter) => enabled[filter.label] && filter.kinds.includes(document.kind)))
    .filter((document) => !search || `${document.title} ${document.id} ${document.name} ${document.runId}`.toLowerCase().includes(search))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="card" aria-labelledby="docs-h">
      <div style={{ padding: '14px 16px 10px' }}><h2 id="docs-h" className="t-h2">Documents</h2></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '0 16px 12px' }}>
        {FILTERS.map((filter) => (
          <button key={filter.label} type="button" className="seg" aria-pressed={enabled[filter.label]} style={{ minHeight: 44 }}
            onClick={() => setEnabled((current) => ({ ...current, [filter.label]: !current[filter.label] }))}>
            <Icon name={filter.icon} size="sm" />{filter.label}
          </button>
        ))}
        <div style={{ position: 'relative', flex: '1 1 180px' }}>
          <label htmlFor="docs-q" className="sr-only">Search documents</label>
          <Icon name="search" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--text-3)' }} />
          <input id="docs-q" className="field" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, path, run" style={{ paddingLeft: 36 }} />
        </div>
      </div>
      {docs.map((d) => {
        const k = DOC_KIND[d.kind];
        const decision = decisionForDocument(hub, d);
        const to = decision ? decisionPath(decision) : `/w/${w.id}/docs/${encodeURIComponent(d.id)}`;
        return (
          <Link key={d.id} className="row" to={to}>
            <span className={`doc-ico ${k.className}`}><Icon name={k.icon} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="trunc" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{d.title}</span>
              <span className="meta">
                <span>Run {d.runId}</span><span className="sep" /><span className="mono">{d.name}</span><span className="sep" />
                <span>{formatBytes(d.bytes)}{d.truncated ? ', truncated' : ''}</span><span className="sep" />
                <span>{ago(d.updatedAt, now)}</span>
              </span>
            </span>
            <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
          </Link>
        );
      })}
      {docs.length === 0 && (
        <p className="t-2" style={{ padding: '0 16px 16px' }}>
          {available.length === 0 ? 'No documents uploaded.' : 'No documents match your search and filters.'}
        </p>
      )}
    </section>
  );
}
