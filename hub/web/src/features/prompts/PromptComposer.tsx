import { useState } from 'react';
import { PROMPT_LIMIT_CHARS } from '@/api/client';
import type { Workspace } from '@/api/types';
import { useClient, useHub } from '@/state/HubProvider';
import { PROMPT_STATUS } from '@/lib/status';
import { hhmm } from '@/lib/time';
import { StatusChip } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { Banner } from '@/components/ui';

const ERRORS: Record<string, string> = {
  workspace_not_online: 'This workspace isn’t running any more.',
  computer_offline: 'The computer is offline. Nothing was sent.',
  hub_unreachable: 'The hub can’t be reached. Try again when it’s back.',
  prompt_too_large: 'The prompt is over 8192 characters.',
};

/** Multi-line prompt to the orchestrator, plus the list of recent prompts and their delivery status. */
export function PromptComposer({ workspace: w }: { workspace: Workspace }) {
  const client = useClient();
  const hub = useHub();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const running = w.status === 'RUNNING' && w.computerOnline;
  const lost = hub.connection === 'lost';
  const chars = text.length;
  const over = chars > PROMPT_LIMIT_CHARS;
  const prompts = hub.prompts.filter((p) => p.workspaceId === w.id).slice(0, 5);

  const send = async () => {
    setError(null);
    setSending(true);
    try {
      await client.sendPrompt(w.id, text.trim());
      setText('');
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field-label" htmlFor={`prompt-${w.id}`} style={{ margin: 0 }}>Prompt Opus</label>
      {running ? (
        <>
          <textarea
            id={`prompt-${w.id}`} className={`field${over ? ' err' : ''}`} value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !over) void send(); }}
            placeholder="Ask something, or add to the request. Typed into the orchestrator’s terminal as [hub] …"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="t-small mono" style={{ color: over ? 'var(--status-blocked)' : undefined }} aria-live="polite">
              {chars} / {PROMPT_LIMIT_CHARS} characters
            </span>
            <span className="t-small">
              {lost ? 'Hub connection lost.' : w.orchestrator.state === 'blocked' ? 'Opus has a terminal prompt open: this will be held.' : 'Only the orchestrator receives prompts.'}
            </span>
            <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }}
              disabled={!text.trim() || over || lost || sending} onClick={() => void send()}>
              <Icon name="send" />Send
            </button>
          </div>
          {error && <p className="err-text" role="alert"><Icon name="alert" size="sm" />{error}</p>}
        </>
      ) : (
        <>
          <textarea id={`prompt-${w.id}`} className="field" disabled placeholder="Prompts are off while this workspace isn’t running." style={{ background: 'var(--surface-2)' }} />
          <Banner icon="lock">
            {!w.computerOnline ? 'Computer offline. Prompts are disabled until it reconnects.'
              : w.status === 'OFFLINE' ? 'This workspace is offline, so prompts are off.'
              : 'This workspace isn’t running. Start it on your computer with agent-kit start.'}
          </Banner>
        </>
      )}

      {prompts.length > 0 && (
        <div className="stack">
          <span className="t-label" style={{ marginBottom: 4 }}>Recent prompts</span>
          {prompts.map((p) => (
            <div key={p.id} className="stack" style={{ padding: '10px 0', borderTop: '1px solid var(--border)', gap: 6 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="trunc" style={{ flex: 1 }}>{p.text}</span>
                <span className="t-small mono">{hhmm(p.createdAt)}</span>
                <StatusChip look={PROMPT_STATUS[p.status]} />
              </div>
              {p.status === 'HELD' && <span className="t-small">{p.reason}</span>}
              {p.status === 'FAILED' && <code className="mono" style={{ fontSize: 12, color: 'var(--status-blocked)' }}>{p.reason}</code>}
              {p.status === 'EXPIRED' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="t-small" style={{ flex: 1 }}>Not delivered within 30 min, so it was dropped.</span>
                  {running && (
                    <button type="button" className="btn btn-sm" style={{ minHeight: 40 }} disabled={lost} onClick={() => void client.resendPrompt(p.id)}>
                      <Icon name="refresh" />Resend
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
