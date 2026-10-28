import { Link } from 'react-router-dom';
import type { HistoryEntry, HubSnapshot } from '@/api/types';
import { useHub } from '@/state/HubProvider';
import { findDecision, decisionPath } from '@/state/selectors';
import { PROMPT_STATUS } from '@/lib/status';
import { hhmm } from '@/lib/time';
import { StatusChip } from '@/components/Chips';
import { Icon, type IconName } from '@/components/Icon';

export interface HistoryView {
  cls: string;
  icon: IconName;
  title: string;
  quote?: string;
  sub: string;
  channelIcon?: IconName;
  chip?: React.ReactNode;
  link?: { to: string; label: string };
  /** Lower-cased text for search. */
  search: string;
}

/** Turns an entry into what the row shows. Pure, so the History page can filter/search on it. */
export function viewHistory(e: HistoryEntry, hub: HubSnapshot): HistoryView {
  const run = e.runId ? `run ${e.runId}` : '';
  if (e.type === 'answer') {
    const d = findDecision(hub, e.workspaceId, e.runId, e.decisionId);
    const title = e.replyOnly ? `You replied to ${e.decisionId}` : `You chose ${e.choice}: ${e.label}${e.extra ? ` (${e.extra})` : ''}`;
    const channel = e.channel === 'terminal' ? 'terminal' : e.channel === 'routine' ? 'routine' : `hub · ${e.by ?? 'unknown user'}`;
    const link = d ? { to: decisionPath(d), label: e.decisionId } : e.docId ? { to: `/w/${e.workspaceId}/docs/${encodeURIComponent(e.docId)}`, label: `${e.decisionId} record` } : undefined;
    const sub = [channel, run].filter(Boolean).join(' · ');
    return {
      cls: 'h-answer', icon: e.replyOnly ? 'message' : 'check', title, quote: e.quote, sub, link,
      channelIcon: e.channel === 'terminal' ? 'terminal' : e.channel === 'routine' ? 'hub' : 'message',
      search: `${title} ${e.quote ?? ''} ${sub} ${e.decisionId}`.toLowerCase(),
    };
  }
  if (e.type === 'prompt') {
    const p = hub.prompts.find((x) => x.id === e.promptId);
    return {
      cls: 'h-prompt', icon: 'message', title: 'You prompted Opus', quote: p?.text, sub: [e.by, run].filter(Boolean).join(' · '), channelIcon: 'message',
      chip: p ? <StatusChip look={PROMPT_STATUS[p.status]} /> : undefined,
      search: `prompt ${p?.text ?? ''} ${run}`.toLowerCase(),
    };
  }
  const sub = `Opus routine call · reason: ${e.reason}${run ? ` · ${run}` : ''}`;
  return {
    cls: 'h-routine', icon: 'hub', title: e.text, sub,
    link: e.docId ? { to: `/w/${e.workspaceId}/docs/${encodeURIComponent(e.docId)}`, label: 'Open document' } : undefined,
    search: `${e.text} ${sub}`.toLowerCase(),
  };
}

export function HistoryRow({ entry, compact }: { entry: HistoryEntry; compact?: boolean }) {
  const hub = useHub();
  const v = viewHistory(entry, hub);
  return (
    <div className={`h-row ${v.cls}`}>
      <span className="h-time">{hhmm(entry.at)}</span>
      <span className="h-mark"><Icon name={v.icon} size="sm" /></span>
      <div className="h-body stack" style={{ gap: 4, minWidth: 0, fontSize: compact ? 13.5 : undefined }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: entry.type === 'routine' ? 400 : 600 }}>{v.title}</span>
          {v.link && !compact && (
            <Link to={v.link.to} style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2, minHeight: 32 }}>
              {v.link.label}<Icon name="chevron-right" size="sm" />
            </Link>
          )}
        </div>
        {v.quote && <span className="quote" style={{ margin: 0, alignSelf: 'flex-start' }}>“{v.quote}”</span>}
        {!compact && (
          <div className="meta">
            {v.chip}
            {v.channelIcon && <Icon name={v.channelIcon} size="sm" />}
            <span>{v.sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}
