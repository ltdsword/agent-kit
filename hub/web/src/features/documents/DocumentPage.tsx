import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHub, useNow } from '@/state/HubProvider';
import { workspaceById } from '@/state/selectors';
import { ago, formatBytes } from '@/lib/time';
import { Icon } from '@/components/Icon';
import { Crumbs } from '@/components/ui';
import { DOC_KIND } from '../workspace/DocumentList';
import { DiffView } from './DiffView';

/**
 * Markdown is rendered with react-markdown: raw HTML in documents is NOT rendered (a document is text a model wrote).
 * Links open in a new tab. Wide tables and code scroll inside their own box.
 */
export function DocumentPage() {
  const { wsId, docId } = useParams();
  const hub = useHub();
  const now = useNow(60_000);
  const w = workspaceById(hub, wsId);
  const doc = hub.documents.find((d) => d.id === docId && d.workspaceId === wsId);
  if (!w || !doc) return <div className="page page-mid"><h1 className="t-h1">Document not found</h1><Link to="/">Back</Link></div>;
  const k = DOC_KIND[doc.kind];

  return (
    <div className="page page-wide fade-in" style={{ paddingTop: 16, gap: 16 }}>
      <Crumbs items={[{ label: 'Workspaces', to: '/' }, { label: w.name, to: `/w/${w.id}` }, { label: doc.runId }, { label: doc.name, mono: true }]} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className={`doc-ico ${k.className}`} style={{ width: 40, height: 40 }}><Icon name={k.icon} size="lg" /></span>
        <div className="stack" style={{ gap: 2 }}>
          <h1 className="t-h1">{doc.title}</h1>
          <span className="meta"><span>{k.label}</span><span className="sep" /><span>{formatBytes(doc.bytes)}</span><span className="sep" /><span>updated {ago(doc.updatedAt, now)}</span></span>
        </div>
      </div>

      {doc.format === 'diff' ? (
        <DiffView doc={doc} />
      ) : (
        <article className="card" style={{ padding: '24px 20px' }}>
          <div className="md md-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                table: ({ node: _n, ...props }) => <div className="table-scroll"><table {...props} /></div>,
              }}
            >
              {doc.content}
            </ReactMarkdown>
          </div>
        </article>
      )}
    </div>
  );
}
