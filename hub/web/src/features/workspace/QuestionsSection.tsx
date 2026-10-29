import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Workspace } from '@/api/types';
import { useHub, useNow } from '@/state/HubProvider';
import { decisionPath, needsYou } from '@/state/selectors';
import { DECISION_STATUS } from '@/lib/status';
import { duration } from '@/lib/time';
import { KindChip, StatusChip } from '@/components/Chips';
import { EmptyState, SectionCard } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { MoreButton, PAGE_SIZE, Pager, pageItems } from '@/components/Pager';

const questionLabel = (id: string) => id.replace(/^D/, 'Q');

export function QuestionsSection({ workspace, compact = false, onMore }: {
  workspace: Workspace;
  compact?: boolean;
  onMore?: () => void;
}) {
  const hub = useHub();
  const now = useNow(15_000);
  const [page, setPage] = useState(1);
  const questions = hub.decisions
    .filter((decision) => decision.workspaceId === workspace.id && decision.runId === 'inbox')
    .sort((a, b) => b.openedAt - a.openedAt);
  const needsCount = needsYou(hub, workspace.id).filter((decision) => decision.runId === 'inbox').length;
  const visible = compact ? questions.slice(0, 15) : pageItems(questions, page, PAGE_SIZE);

  return (
    <SectionCard id="questions" title="Questions" icon="message" tone={needsCount ? 'needs' : undefined}
      right={needsCount > 0 && <span className="count" aria-label={`${needsCount} questions need you`}>{needsCount}</span>}>
      {visible.map((decision) => (
        <Link key={`${decision.runId}/${decision.id}`} className="row" to={decisionPath(decision)} style={{ minHeight: 64 }}>
          <span className="mono" style={{ fontWeight: 600, width: 28 }}>{questionLabel(decision.id)}</span>
          <KindChip kind={decision.kind} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="trunc" style={{ fontWeight: 600 }}>{decision.title}</span>
            <span className="meta">
              <span>{decision.agent} · {duration(decision.openedAt, now)}</span>
              <StatusChip look={DECISION_STATUS[decision.status]} label={decision.status === 'REJECTED' ? 'Rejected, fix it' : undefined} />
            </span>
          </span>
          <Icon name="chevron-right" style={{ color: 'var(--text-3)' }} />
        </Link>
      ))}
      {questions.length === 0 && <EmptyState icon="message" title="No questions yet." />}
      {compact && questions.length > 15 && onMore && <div style={{ padding: '0 16px 12px', textAlign: 'right' }}><MoreButton onClick={onMore} /></div>}
      {!compact && <Pager page={page} totalItems={questions.length} onPageChange={setPage} />}
    </SectionCard>
  );
}
