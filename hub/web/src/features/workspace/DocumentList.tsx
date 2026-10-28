import { Link } from 'react-router-dom';
import type { DocumentKind, Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { documentsByRun } from '@/state/selectors';
import { ago, formatBytes } from '@/lib/time';
import { Icon, type IconName } from '@/components/Icon';

export const DOC_KIND: Record<DocumentKind, { icon: IconName; className: string; label: string }> = {
  final_report: { icon: 'file', className: 'report', label: 'Final report' },
  final_diff: { icon: 'diff', className: 'diff', label: 'Total diff' },
  task_file: { icon: 'file', className: '', label: 'Task plan' },
  decision: { icon: 'bell', className: 'decision', label: 'Decision record' },
  research: { icon: 'compass', className: 'research', label: 'Research dossier' },
  review: { icon: 'eye', className: '', label: 'Review report' },
};

export function DocumentList({ workspace: w }: { workspace: Workspace }) {
  const hub = useHub();
  const now = useNow(60_000);
  const groups = documentsByRun(hub, w.id);
  return (
    <section className="card" aria-labelledby="docs-h">
      <div style={{ padding: '14px 16px 6px' }}><h2 id="docs-h" className="t-h2">Documents</h2></div>
      {groups.length === 0 && <p className="t-2" style={{ padding: '0 16px 16px' }}>No documents uploaded.</p>}
      {groups.map((g) => (
        <div key={g.runId}>
          <div className="t-label" style={{ padding: '10px 16px 2px' }}>Run {g.runId}</div>
          {g.docs.map((d) => {
            const k = DOC_KIND[d.kind];
            return (
              <Link key={d.id} className="row" to={`/w/${w.id}/docs/${d.id}`}>
                <span className={`doc-ico ${k.className}`}><Icon name={k.icon} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="trunc" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{d.title}</span>
                  <span className="meta">
                    <span className="mono">{d.name}</span><span className="sep" />
                    <span>{formatBytes(d.bytes)}{d.truncated ? ', truncated' : ''}</span><span className="sep" />
                    <span>{ago(d.updatedAt, now)}</span>
                  </span>
                </span>
                <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
