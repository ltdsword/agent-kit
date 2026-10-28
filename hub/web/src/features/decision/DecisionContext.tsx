import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Decision } from '@/api/types';
import { useHub } from '@/state/HubProvider';
import { documentForDecision } from '@/state/selectors';
import { Icon, type IconName } from '@/components/Icon';
import { parseDiff } from '../documents/parseDiff';

const WHY_ICONS: IconName[] = ['globe', 'folder', 'info'];

/** "What happened": evidence, the worker-approval command, or the finish report + diff stat. */
export function DecisionContext({ decision: d }: { decision: Decision }) {
  const hub = useHub();
  const rawFile = documentForDecision(hub, d);
  return (
    <>
      {d.approval && (
        <section aria-label="Command" className="stack" style={{ gap: 10 }}>
          <div className="term" style={{ fontSize: 15, padding: 14, whiteSpace: 'pre-wrap' }}><span className="d">$ </span>{d.approval.command}</div>
          <div className="meta"><Icon name="folder" size="sm" /><span className="mono">{d.approval.cwd}</span></div>
          <h2 className="t-label">Why it’s outside the sandbox</h2>
          <div className="inset stack" style={{ padding: 12, gap: 10, fontSize: 13.5 }}>
            {d.approval.why.map((t, i) => (
              <div key={t} style={{ display: 'flex', gap: 10 }}>
                <Icon name={WHY_ICONS[i] ?? 'info'} style={{ color: 'var(--status-review)', marginTop: 2 }} /><span>{t}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {d.question && (
        <section className="stack" style={{ gap: 8 }} aria-labelledby="what-h">
          <h2 id="what-h" className="t-label">What happened</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.5 }}>{d.question}</p>
          {d.evidence.length > 0 && (
            <div className="inset stack" style={{ padding: '10px 12px', gap: 6, fontSize: 12.5 }}>
              {d.evidence.map((e) => (
                <div key={e.code} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="mono">{e.code}</span>
                  <span className={e.bad ? 'chip c-blocked task-chip' : 't-2'}>{e.note}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {rawFile && (
        <Link to={`/w/${d.workspaceId}/docs/${encodeURIComponent(rawFile.id)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, fontSize: 13, fontWeight: 600 }}>
          <Icon name="file" size="sm" />Raw file<Icon name="chevron-right" size="sm" />
        </Link>
      )}

      {d.kind === 'finish' && <FinishReport decision={d} />}
    </>
  );
}

function FinishReport({ decision: d }: { decision: Decision }) {
  const hub = useHub();
  const report = hub.documents.find((x) => x.workspaceId === d.workspaceId && x.runId === d.runId && x.kind === 'final_report');
  const diff = hub.documents.find((x) => x.workspaceId === d.workspaceId && x.runId === d.runId && x.kind === 'final_diff');
  const files = diff ? parseDiff(diff.content) : [];
  const add = files.reduce((n, f) => n + f.added, 0);
  const del = files.reduce((n, f) => n + f.removed, 0);
  return (
    <>
      {report && (
        <details className="card" open>
          <summary style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '0 14px', cursor: 'pointer', listStyle: 'none' }}>
            <span className="doc-ico report"><Icon name="file" /></span>
            <span className="stack"><span style={{ fontWeight: 600 }}>Final report</span><span className="t-small mono">{report.name}</span></span>
            <Icon name="chevron-down" style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
          </summary>
          <div className="md md-body" style={{ padding: '0 14px 14px', fontSize: 14 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
          </div>
        </details>
      )}
      {diff && (
        <Link className="card" to={`/w/${d.workspaceId}/docs/${diff.id}`} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
          <span className="doc-ico diff"><Icon name="diff" /></span>
          <span style={{ fontWeight: 600 }}>{files.length} files changed</span>
          <span className="plus mono">+{add}</span><span className="minus mono">−{del}</span>
          <Icon name="chevron-right" style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
        </Link>
      )}
    </>
  );
}
