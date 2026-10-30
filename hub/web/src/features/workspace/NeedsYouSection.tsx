import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Decision, Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionPath, inFlight, needsYou } from '@/state/selectors';
import { DECISION_STATUS } from '@/lib/status';
import { duration } from '@/lib/time';
import { KindChip, StatusChip } from '@/components/Chips';
import { EmptyState, SectionCard } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { MoreButton, PAGE_SIZE, Pager, pageItems } from '@/components/Pager';

type Category = 'Finish' | 'Blocker' | 'Other';
const CATEGORIES: Category[] = ['Finish', 'Blocker', 'Other'];

function category(d: Decision): Category {
  if (d.kind === 'finish') return 'Finish';
  if (d.kind === 'blocker') return 'Blocker';
  return 'Other';
}

export function NeedsYouSection({ workspace, compact = false, onMore }: {
  workspace: Workspace;
  compact?: boolean;
  onMore?: () => void;
}) {
  const hub = useHub();
  const now = useNow(15_000);
  const needs = needsYou(hub, workspace.id).filter((decision) => decision.runId !== 'inbox');
  const flying = inFlight(hub, workspace.id).filter((decision) => decision.runId !== 'inbox');
  const all = hub.decisions
    .filter((decision) => decision.workspaceId === workspace.id && decision.runId !== 'inbox')
    .sort((a, b) => b.openedAt - a.openedAt);
  // "All decisions" folds away (it grows with every run) and filters by category; open ones stay above, unfiltered.
  const [expanded, setExpanded] = useState(false);
  const showingAll = expanded || compact;
  const [hidden, setHidden] = useState<Record<Category, boolean>>({ Finish: false, Blocker: false, Other: false });
  const [page, setPage] = useState(1);
  const present = CATEGORIES.filter((c) => all.some((d) => category(d) === c));
  const shown = all.filter((d) => !hidden[category(d)]);
  const visible = compact ? shown.slice(0, 15) : pageItems(shown, page, PAGE_SIZE);

  return (
    <SectionCard id="needs" title="Decisions" icon="bell" tone={needs.length ? 'needs' : undefined}
      right={needs.length > 0 && <span className="count">{needs.length}</span>}>
      <div role="group" aria-label="Open decisions">
        {(compact ? needs.slice(0, 15) : needs).map((d) => (
          <Link key={`${d.runId}/${d.id}`} className="row" to={decisionPath(d)} style={{ minHeight: 64 }}>
            <span className="mono" style={{ fontWeight: 600, width: 28 }}>{d.id}</span>
            <KindChip kind={d.kind} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="trunc" style={{ fontWeight: 600 }}>{d.title}</span>
              <span className="meta">
                <span>{d.agent}{d.taskId ? ` · ${d.taskId}` : ''} · {duration(d.openedAt, now)}</span>
                {d.status !== 'OPEN' && <StatusChip look={DECISION_STATUS[d.status]} label={d.status === 'REJECTED' ? 'Rejected, fix it' : undefined} />}
              </span>
            </span>
            <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
          </Link>
        ))}
        {needs.length === 0 && (
          <EmptyState icon="check" title="Nothing needs you.">Opus asks here when a call is yours.</EmptyState>
        )}
        {flying.length > 0 && (
          <>
            <div className="t-label" style={{ borderTop: '1px solid var(--border)', padding: '8px 16px 4px' }}>Answered, on the way</div>
            {(compact ? flying.slice(0, 15) : flying).map((d) => (
              <Link key={`${d.runId}/${d.id}`} className="row" to={decisionPath(d)}>
                <span className="mono" style={{ fontWeight: 600, width: 28 }}>{d.id}</span>
                <span className="trunc" style={{ flex: 1 }}>{d.title}</span>
                <StatusChip look={DECISION_STATUS[d.status]} />
              </Link>
            ))}
          </>
        )}
      </div>
      <section role="region" aria-label="All decisions" style={{ borderTop: '1px solid var(--border)' }}>
        <h3 className="t-label" style={{ margin: 0 }}>
          {compact ? (
            <span className="row">
              <span style={{ flex: 1 }}>All decisions</span>
              <span className="count">{all.length}</span>
            </span>
          ) : (
            <button type="button" className="row" aria-expanded={expanded} aria-controls="all-decisions-list"
              onClick={() => setExpanded((v) => !v)} style={{ width: '100%', background: 'none', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
              <span style={{ flex: 1, textAlign: 'left' }}>All decisions</span>
              <span className="count">{all.length}</span>
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} style={{ color: 'var(--text-3)' }} />
            </button>
          )}
        </h3>
        {showingAll && <div id="all-decisions-list">
        {present.length > 1 && (
          <div role="group" aria-label="Filter decisions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 16px 10px' }}>
            {present.map((c) => (
              <button key={c} type="button" className="seg" aria-pressed={!hidden[c]} style={{ minHeight: 44 }}
                onClick={() => { setHidden((current) => ({ ...current, [c]: !current[c] })); setPage(1); }}>
                {c} <span className="t-small">{all.filter((d) => category(d) === c).length}</span>
              </button>
            ))}
          </div>
        )}
        {visible.map((d) => (
          <Link key={`${d.runId}/${d.id}`} className="row" to={decisionPath(d)} style={{ minHeight: 64 }}>
            <span className="mono" style={{ fontWeight: 600, width: 28, flex: 'none' }}>{d.id}</span>
            {/* Run and kind sit on the wrapping meta line so the row fits a phone width. */}
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="trunc" style={{ fontWeight: 600 }}>{d.title}</span>
              <span className="meta">
                <span className="mono" style={{ whiteSpace: 'nowrap' }}>Run {d.runId}</span>
                <KindChip kind={d.kind} />
                {d.answer && <><span>{d.answer.by ?? d.answer.channel}</span><span className="trunc">{d.answer.choice}: {d.answer.label}</span></>}
              </span>
            </span>
            <StatusChip look={DECISION_STATUS[d.status]} />
            <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
          </Link>
        ))}
        {all.length === 0 && <p className="t-2" style={{ padding: '8px 16px 16px' }}>No decisions recorded.</p>}
        {all.length > 0 && shown.length === 0 && <p className="t-2" style={{ padding: '8px 16px 16px' }}>No decisions match these filters.</p>}
        {showingAll && !compact && <Pager page={page} totalItems={shown.length} onPageChange={setPage} />}
        </div>}
      </section>
      {compact && shown.length > 15 && onMore && <div style={{ padding: '0 16px 12px', textAlign: 'right' }}><MoreButton onClick={() => { setExpanded(true); onMore(); }} /></div>}
    </SectionCard>
  );
}
