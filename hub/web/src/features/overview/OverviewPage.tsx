import { useHub, useNow } from '@/state/HubProvider';
import { visibleWorkspaces } from '@/state/selectors';
import { SkeletonCard } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { WorkspaceCard } from './WorkspaceCard';

export function OverviewPage() {
  const hub = useHub();
  const now = useNow(15_000);
  const list = visibleWorkspaces(hub);
  const count = (s: string) => list.filter((w) => w.status === s).length;
  const summary = [`${count('RUNNING')} running`, count('OFFLINE') && `${count('OFFLINE')} offline`, count('STOPPED') && `${count('STOPPED')} stopped`]
    .filter(Boolean).join(' · ');

  return (
    <div className="page page-wide fade-in">
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="t-h1">Workspaces</h1>
        {list.length > 0 && <p className="t-2">{summary}. Workspaces start on your computer with <code className="mono">agent-kit start</code>.</p>}
      </div>

      {!hub.loaded ? (
        <div className="grid-cards" aria-busy="true" aria-label="Loading workspaces">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : list.length === 0 ? (
        <NoWorkspaces />
      ) : (
        <div className="grid-cards">
          {list.map((w) => <WorkspaceCard key={w.id} workspace={w} now={now} />)}
        </div>
      )}
    </div>
  );
}

function NoWorkspaces() {
  return (
    <div className="card" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', maxWidth: 620 }}>
      <span className="doc-ico" style={{ width: 44, height: 44 }}><Icon name="laptop" size="lg" /></span>
      <h2 className="t-h2">No workspaces yet</h2>
      <p className="t-2">The hub only shows workspaces your computer connects. In a workspace folder on your computer:</p>
      <pre className="term" style={{ width: '100%' }}>
        {'agent-kit hub enable     '}<span className="d"># once per workspace</span>{'\n'}
        {'agent-kit start          '}<span className="d"># it appears here as Running</span>
      </pre>
    </div>
  );
}
