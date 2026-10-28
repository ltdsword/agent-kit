import { useMemo, useState } from 'react';
import type { HubDocument } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';
import { parseDiff, type DiffFile } from './parseDiff';

const SIGN = { add: '+', del: '-', ctx: ' ', hunk: '' } as const;
const CLASS = { add: 'add', del: 'del', ctx: '', hunk: 'hunk' } as const;

/** File list with +/− counts, collapsible files. Horizontal scroll only inside the code. */
export function DiffView({ doc }: { doc: HubDocument }) {
  const files = useMemo(() => parseDiff(doc.content), [doc.content]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => (files[0] ? { [files[0].path]: true } : {}));
  const toggle = (p: string) => setOpen((o) => ({ ...o, [p]: !o[p] }));
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);

  return (
    <>
      {doc.truncated && (
        <Banner tone="stale" icon="alert" role="status">
          <strong>Truncated at 1 MB.</strong> Showing the first {files.length} files. The full diff is on your computer:{' '}
          <code className="mono">.orchestrator/runs/{doc.runId}/final.diff</code>
        </Banner>
      )}
      <div className="cols">
        <nav className="card" aria-label="Changed files" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <strong>{files.length} files</strong><span className="plus mono">+{added}</span><span className="minus mono">−{removed}</span>
          </div>
          {files.map((f) => (
            <button key={f.path} type="button" className="row" onClick={() => toggle(f.path)} aria-expanded={!!open[f.path]} style={{ minHeight: 48, gap: 8 }}>
              <Icon name={open[f.path] ? 'chevron-down' : 'chevron-right'} size="sm" style={{ color: 'var(--text-3)' }} />
              <span className="trunc mono" style={{ flex: 1, fontSize: 12.5 }} title={f.path}>{f.path.split('/').slice(-2).join('/')}</span>
              <span className="plus mono" style={{ fontSize: 12 }}>+{f.added}</span>
              <span className="minus mono" style={{ fontSize: 12 }}>−{f.removed}</span>
            </button>
          ))}
        </nav>
        <div className="stack" style={{ flex: '999 1 560px', minWidth: 0, gap: 12 }}>
          {files.map((f) => <FileDiff key={f.path} file={f} open={!!open[f.path]} onToggle={() => toggle(f.path)} />)}
        </div>
      </div>
    </>
  );
}

function FileDiff({ file: f, open, onToggle }: { file: DiffFile; open: boolean; onToggle: () => void }) {
  const total = f.added + f.removed || 1;
  const addCells = Math.round((f.added / total) * 5);
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <button type="button" className="row" onClick={onToggle} aria-expanded={open} style={{ background: 'var(--surface-2)', gap: 8 }}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} style={{ color: 'var(--text-3)' }} />
        <span className="mono trunc" style={{ flex: 1, fontSize: 12.5 }}>{f.path}</span>
        <span className="bar" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < addCells ? 'a' : 'r'} />)}</span>
        <span className="plus mono" style={{ fontSize: 12 }}>+{f.added}</span>
        <span className="minus mono" style={{ fontSize: 12 }}>−{f.removed}</span>
      </button>
      {open && (
        <div className="diff">
          {f.hunks.flat().map((l, i) => (
            <div key={i} className={`dl ${CLASS[l.kind]}`}>
              <span className="ln">{l.oldNo ?? ''}</span>
              <span className="ln">{l.newNo ?? ''}</span>
              <span>{SIGN[l.kind]}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
