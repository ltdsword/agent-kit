import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockHubClient, invalidBranchReason } from './MockHubClient';

const fast = { load: 0, deliver: 10, apply: 10, prompt: 10, reply: 10, finish: 10 };
const status = (c: MockHubClient, ws: string, run: string, id: string) =>
  c.getSnapshot().decisions.find((d) => d.workspaceId === ws && d.runId === run && d.id === id)?.status;

describe('MockHubClient', () => {
  let c: MockHubClient;
  beforeEach(() => { vi.useFakeTimers(); c = new MockHubClient({ delays: fast, heartbeat: false }); });
  afterEach(() => { c.dispose(); vi.useRealTimers(); });

  it('moves an answer Sent → Delivered → Applied and records history', async () => {
    await c.answerDecision('ws_k3m9q2', 'r4', 'D3', { choice: 'A', note: 'keep wording' });
    expect(status(c, 'ws_k3m9q2', 'r4', 'D3')).toBe('SENT');
    await vi.advanceTimersByTimeAsync(10);
    expect(status(c, 'ws_k3m9q2', 'r4', 'D3')).toBe('DELIVERED');
    await vi.advanceTimersByTimeAsync(10);
    expect(status(c, 'ws_k3m9q2', 'r4', 'D3')).toBe('APPLIED');
    const h = c.getSnapshot().history[0]!;
    expect(h.type).toBe('answer');
  });

  it('keeps an answer waiting while the workspace is offline', async () => {
    await c.answerDecision('ws_q7l2a1', 'r7', 'D2', { choice: 'B' });
    await vi.advanceTimersByTimeAsync(100);
    expect(status(c, 'ws_q7l2a1', 'r7', 'D2')).toBe('WAITING');
  });

  it('refuses a second answer once it is no longer open', async () => {
    await c.answerDecision('ws_k3m9q2', 'r4', 'D3', { choice: 'A' });
    await expect(c.answerDecision('ws_k3m9q2', 'r4', 'D3', { choice: 'B' })).rejects.toThrow('decision_not_open');
  });

  it('refuses prompts to a workspace that is not running', async () => {
    await expect(c.sendPrompt('ws_p8x1d0', 'hi')).rejects.toThrow('workspace_not_online');
  });

  it('delivers a prompt to an idle orchestrator', async () => {
    await c.sendPrompt('ws_k3m9q2', 'run the gate');
    expect(c.getSnapshot().prompts[0]!.status).toBe('QUEUED');
    await vi.advanceTimersByTimeAsync(10);
    expect(c.getSnapshot().prompts[0]!.status).toBe('DELIVERED');
  });

  it('holds a prompt while the orchestrator has a terminal prompt open', async () => {
    c.actions({}).find((a) => a.label.startsWith('Opus opens a terminal prompt'))!.run();
    await c.sendPrompt('ws_k3m9q2', 'run the gate');
    await vi.advanceTimersByTimeAsync(10);
    expect(c.getSnapshot().prompts[0]!.status).toBe('HELD');
    c.actions({}).find((a) => a.label === 'Opus closes its terminal prompt')!.run();
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getSnapshot().prompts[0]!.status).toBe('DELIVERED');
  });

  it('rejects an invalid branch on a finish decision', async () => {
    c.actions({}).find((a) => a.label.startsWith('Skip ahead'))!.run();
    await c.answerDecision('ws_k3m9q2', 'r4', 'D6', { choice: 'A', branch: 'bad name' });
    await vi.advanceTimersByTimeAsync(10);
    const d = c.getSnapshot().decisions.find((x) => x.id === 'D6')!;
    expect(d.status).toBe('REJECTED');
    expect(d.rejectReason).toMatch(/check-ref-format/);
  });
});

describe('invalidBranchReason', () => {
  it.each([['main', null], ['release/v2', null]])('accepts %s', (b, r) => expect(invalidBranchReason(b)).toBe(r));
  it.each(['agent/x', 'bad name', 'a..b', 'trailing/', '.hidden'])('rejects %s', (b) => expect(invalidBranchReason(b)).not.toBeNull());
});
