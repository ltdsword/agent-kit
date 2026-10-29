import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useHub, useNow } from '@/state/HubProvider';
import { needsYou, workspaceById } from '@/state/selectors';
import { WORKSPACE_STATUS } from '@/lib/status';
import { StatusChip } from '@/components/Chips';
import { Banner, Crumbs } from '@/components/ui';
import { workspaceStatusLabel } from './labels';
import { NeedsYouSection } from './NeedsYouSection';
import { OrchestratorCard } from './OrchestratorCard';
import { SubagentsSection } from './SubagentsSection';
import { RunCard } from './RunCard';
import { DocumentList } from './DocumentList';
import { HistoryPreview } from './HistoryPreview';
import { QuestionsSection } from './QuestionsSection';

type Tab = 'all' | 'decisions' | 'questions' | 'agents' | 'runs' | 'docs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Everything' }, { id: 'decisions', label: 'Decisions' }, { id: 'questions', label: 'Questions' }, { id: 'agents', label: 'Agents' },
  { id: 'runs', label: 'Runs' }, { id: 'docs', label: 'Documents' },
];

export function WorkspacePage() {
  const { wsId } = useParams();
  const navigate = useNavigate();
  const hub = useHub();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('all');
  const w = workspaceById(hub, wsId);
  // Until the workspace list has loaded once, a missing workspace means "still connecting", not "removed".
  if (!w) return hub.loaded ? <NotFound /> : <Connecting />;

  const needs = needsYou(hub, w.id);
  const questionNeedCount = needs.filter((decision) => decision.runId === 'inbox').length;
  const needCount = needs.length - questionNeedCount;
  const show = (t: Tab) => tab === 'all' || tab === t;
  // A tab whose content sits in one column gets that column alone, wide and centred.
  const hasMain = show('decisions') || show('questions') || show('agents');
  const hasSide = show('runs') || show('docs') || show('decisions') || show('all');

  return (
    <div className="fade-in stack">
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="stack" style={{ maxWidth: 1240, margin: '0 auto', padding: '14px 16px 0', gap: 10 }}>
          <Crumbs items={[{ label: 'Workspaces', to: '/' }, { label: w.name }]} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="t-h1">{w.name}</h1>
            <StatusChip look={WORKSPACE_STATUS[w.status]} label={workspaceStatusLabel(w, now)} large />
            <span className="meta"><span className="mono">{w.id}</span><span className="sep" /><span className="mono">{w.path}</span><span className="sep" /><span>kit {w.kitVersion}</span></span>
          </div>
          <nav className="tabs" aria-label="Sections" style={{ borderBottom: 0 }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`tab${tab === t.id ? ' on' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'decisions' && needCount > 0 && <span className="count">{needCount}</span>}
                {t.id === 'questions' && questionNeedCount > 0 && <span className="count">{questionNeedCount}</span>}
              </button>
            ))}
            <Link className="tab" to={`/w/${w.id}/history`}>History</Link>
          </nav>
        </div>
      </div>

      {(w.status !== 'RUNNING' || !w.computerOnline) && (
        <div style={{ maxWidth: 1240, width: '100%', margin: '0 auto', padding: '16px 16px 0' }}>
          <Banner icon={w.status === 'OFFLINE' ? 'wifi-off' : 'power'} role="status">
            {!w.computerOnline
              ? <><strong>Computer offline.</strong> Data may be stale or unavailable. Answers and prompts are disabled until it reconnects.</>
              : w.status === 'OFFLINE'
              ? <><strong>This workspace is offline.</strong> Answers can wait for your computer. Prompts are off.</>
              : <><strong>This workspace isn’t running.</strong> Documents and history stay readable; you can’t prompt or answer.</>}
            {w.computerOnline && w.status === 'STOPPED' && <> Start it on your computer with <code className="mono">agent-kit start</code>.</>}
          </Banner>
        </div>
      )}

      <div className="page page-wide cols" style={{ paddingTop: 16, flexDirection: 'row' }}>
        {hasMain && (
          <div className={`col-main${hasSide ? '' : ' col-solo'}`}>
            {show('decisions') && <NeedsYouSection workspace={w} compact={tab === 'all'} onMore={() => setTab('decisions')} />}
            {show('questions') && <QuestionsSection workspace={w} compact={tab === 'all'} onMore={() => setTab('questions')} />}
            {show('agents') && <OrchestratorCard workspace={w} />}
            {show('agents') && <SubagentsSection workspace={w} />}
          </div>
        )}
        {hasSide && (
          <div className={`col-side${hasMain ? '' : ' col-solo'}`}>
            {show('runs') && <RunCard workspace={w} />}
            {show('docs') && <DocumentList workspace={w} compact={tab === 'all'} onMore={() => setTab('docs')} />}
            {(show('all') || show('decisions')) && <HistoryPreview workspace={w} compact onMore={() => navigate(`/w/${w.id}/history`)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Connecting() {
  return (
    <div className="page page-mid" aria-busy="true">
      <h1 className="t-h1">Connecting…</h1>
      <p className="t-2">Loading this workspace from the hub.</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page page-mid">
      <h1 className="t-h1">Workspace not found</h1>
      <p className="t-2">It may have been removed from the hub. <Link to="/">Back to workspaces</Link>.</p>
    </div>
  );
}
