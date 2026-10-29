import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentKind, Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionForDocument, decisionPath } from '@/state/selectors';
import { ago, formatBytes } from '@/lib/time';
import { Icon, type IconName } from '@/components/Icon';
import { MoreButton, PAGE_SIZE, Pager, pageItems } from '@/components/Pager';

export const DOC_KIND: Record<DocumentKind, { icon: IconName; className: string; label: string }> = {
  final_report: { icon: 'file', className: 'report', label: 'Final report' },
  final_diff: { icon: 'diff', className: 'diff', label: 'Total diff' },
  decision: { icon: 'bell', className: 'decision', label: 'Decision record' },
  research: { icon: 'compass', className: 'research', label: 'Research dossier' },
  plan: { icon: 'file', className: 'report', label: 'Plan' },
  review: { icon: 'file', className: 'report', label: 'Review' },
  other: { icon: 'file', className: 'report', label: 'Document' },
};

type Category = 'Run' | 'Plan' | 'Other';
type RunKind = 'Final report' | 'Diff' | 'Decisions' | 'Scout';
const CATEGORIES: Category[] = ['Run', 'Plan', 'Other'];
const RUN_KINDS: { label: RunKind; kind: DocumentKind; icon: IconName }[] = [
  { label: 'Final report', kind: 'final_report', icon: 'file' },
  { label: 'Diff', kind: 'final_diff', icon: 'diff' },
  { label: 'Decisions', kind: 'decision', icon: 'bell' },
  { label: 'Scout', kind: 'research', icon: 'compass' },
];

export function DocumentList({ workspace: w, compact = false, onMore }: {
  workspace: Workspace;
  compact?: boolean;
  onMore?: () => void;
}) {
  const hub = useHub();
  const now = useNow(60_000);
  const [categories, setCategories] = useState<Record<Category, boolean>>({ Run: false, Plan: false, Other: false });
  const [runKinds, setRunKinds] = useState<Record<RunKind, boolean>>({ 'Final report': true, Diff: true, Decisions: true, Scout: true });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = query.trim().toLowerCase();
  const available = hub.documents.filter((document) => document.workspaceId === w.id);
  const selected = CATEGORIES.some((category) => categories[category]);
  const kinds = [
    ...(categories.Run ? RUN_KINDS.filter((item) => runKinds[item.label]).map((item) => item.kind) : []),
    ...(categories.Plan ? ['plan' as const] : []),
    ...(categories.Other ? ['review' as const, 'other' as const] : []),
  ];
  const docs = available
    .filter((document) => !selected || kinds.includes(document.kind))
    .filter((document) => !search || `${document.title} ${document.id} ${document.name} ${document.runId}`.toLowerCase().includes(search))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const visibleDocs = compact ? docs.slice(0, 15) : pageItems(docs, page, PAGE_SIZE);

  return (
    <section className="card" aria-labelledby="docs-h">
      <div style={{ padding: '14px 16px 10px' }}><h2 id="docs-h" className="t-h2">Documents</h2></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '0 16px 12px' }}>
        {CATEGORIES.map((category) => (
          <button key={category} type="button" className="seg" aria-pressed={categories[category]} style={{ minHeight: 44 }}
            onClick={() => { setCategories((current) => ({ ...current, [category]: !current[category] })); setPage(1); }}>
            {category}
          </button>
        ))}
        {categories.Run && (
          <div role="group" aria-label="Run document kinds" style={{ display: 'contents' }}>
            {RUN_KINDS.map((item) => (
              <button key={item.label} type="button" className="seg" aria-pressed={runKinds[item.label]} style={{ minHeight: 44 }}
                onClick={() => { setRunKinds((current) => ({ ...current, [item.label]: !current[item.label] })); setPage(1); }}>
                <Icon name={item.icon} size="sm" />{item.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ position: 'relative', flex: '1 1 180px' }}>
          <label htmlFor="docs-q" className="sr-only">Search documents</label>
          <Icon name="search" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--text-3)' }} />
          <input id="docs-q" className="field" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search title, path, run" style={{ paddingLeft: 36 }} />
        </div>
      </div>
      {visibleDocs.map((d) => {
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
      {compact && docs.length > 15 && onMore && <div style={{ padding: '0 16px 12px', textAlign: 'right' }}><MoreButton onClick={onMore} /></div>}
      {!compact && <Pager page={page} totalItems={docs.length} onPageChange={setPage} />}
    </section>
  );
}
