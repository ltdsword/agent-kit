import { describe, expect, it } from 'vitest';
import type { HubDecision, WorkspaceDetail, WorkspaceSummary } from '../protocol';
import detailFixture from '../../../../protocol/fixtures/WorkspaceDetail.json';
import workspaceListFixture from '../../../../protocol/fixtures/List.workspaces.json';
import historyListFixture from '../../../../protocol/fixtures/List.history.json';
import openDecisionFixture from '../../../../protocol/fixtures/HubDecision.open.json';
import replyDecisionFixture from '../../../../protocol/fixtures/HubDecision.reply-sent.json';
import approvalFixture from '../../../../protocol/fixtures/Decision.worker-approval.json';
import documentContentFixture from '../../../../protocol/fixtures/DocumentContent.json';
import {
  collectPages, mapDecision, mapDecisions, mapDocumentContent, mapHistoryItem, mapWorkspaceDetail,
  mapWorkspaceSummary,
} from './adapter';

const detail = detailFixture as unknown as WorkspaceDetail;
const workspaceList = workspaceListFixture as { items: WorkspaceSummary[]; next: string | null };
const historyList = historyListFixture as { items: import('../protocol').HistoryItem[]; next: string | null };

describe('protocol v2 adapter', () => {
  it('maps workspace summaries and offline computers', () => {
    const summary = workspaceList.items[1]!;
    const offline = mapWorkspaceSummary({
      ...summary, status: 'OFFLINE', computer_id: 'c_bbbbbbbbbbbbbbbb', computer_online: false,
    });
    expect(offline).toMatchObject({ status: 'OFFLINE', computerId: 'c_bbbbbbbbbbbbbbbb', computerOnline: false });
    expect(offline.uploads).toEqual({ documents: false, diffs: false, orchestratorScreen: false });
  });

  it('maps detail run, task summaries, finish history and gate status', () => {
    const workspace = mapWorkspaceDetail(detail);
    expect(workspace.status).toBe('RUNNING');
    expect(workspace.run).toMatchObject({
      id: 'r4', title: 'User name validation',
      goal: 'Enforce clear name limits and validate the related input paths.', gate: 'NOT_RUN',
    });
    expect(workspace.run?.tasks[0]).toMatchObject({ id: 'T1', summary: 'Keep user names within the documented character limit.' });
    expect(workspace.run?.problems[0]?.severity).toBe('warn');
    expect(workspace.pastRuns[0]).toMatchObject({ id: 'r3', status: 'MERGED', outcome: 'merged into main, pushed to origin/main' });
    expect(workspace.workers[0]).not.toHaveProperty('screen');
  });

  it('follows opaque list cursors until the final page', async () => {
    const calls: (string | null)[] = [];
    const items = await collectPages<{ id: string }>(async (cursor) => {
      calls.push(cursor);
      return cursor === null
        ? { items: [{ id: 'first' }], next: 'opaque-cursor' }
        : { items: [{ id: 'second' }], next: null };
    });
    expect(calls).toEqual([null, 'opaque-cursor']);
    expect(items.map((item) => item.id)).toEqual(['first', 'second']);
  });

  it('keeps decision evidence, worker approval and REPLY_SENT', () => {
    const open = openDecisionFixture as unknown as HubDecision;
    const workerDecision = { ...open, hub_status: 'ROUTINE' as const, decision: approvalFixture as unknown as HubDecision['decision'] };
    const mapped = mapDecision(workerDecision, 'RUNNING');
    expect(mapped).toMatchObject({ status: 'ROUTINE', opusNote: 'The protocol suite is required for this change.' });
    expect(mapped.approval).toEqual({
      command: 'npm test -w @agent-hub/protocol', cwd: '/repo/hub', why: ['Verify the protocol contract.'],
    });
    expect(mapped.evidence[0]).toMatchObject({ code: 'task-scope', note: 'The command is within the assigned test scope.' });
    expect(mapDecision(replyDecisionFixture as unknown as HubDecision, 'OFFLINE').status).toBe('REPLY_SENT');
    expect(mapDecision({ ...open, hub_status: 'SENT' }, 'OFFLINE').status).toBe('WAITING');
  });

  it('adapts every decision list item and orders the list newest first', () => {
    const open = openDecisionFixture as unknown as HubDecision;
    const reply = replyDecisionFixture as unknown as HubDecision;
    const older = {
      ...open,
      decision: { ...open.decision, decision_id: 'D1', opened_at: '2026-10-27T08:00:00.000Z' },
    };
    const newer = {
      ...reply,
      decision: { ...reply.decision, decision_id: 'D2', opened_at: '2026-10-28T08:00:00.000Z' },
    };

    const mapped = mapDecisions([older, newer], 'RUNNING');
    expect(mapped.map((decision) => decision.id)).toEqual(['D2', 'D1']);
    expect(mapped[0]).toMatchObject({ runId: 'r4', status: 'REPLY_SENT' });
  });

  it('maps text documents and history authors/channels', () => {
    const source = documentContentFixture as unknown as import('../protocol').DocumentContent;
    const document = mapDocumentContent('ws_k3m7q2abcdefghij', {
      ...source,
      meta: { ...source.meta, path: 'approval.txt', format: 'text' },
    });
    expect(document).toMatchObject({ id: 'approval.txt', format: 'text', content: source.content });

    const chatAnswer = historyList.items.find((item) => item.channel === 'chat')!;
    expect(mapHistoryItem(chatAnswer, 'ws_k3m7q2abcdefghij')).toMatchObject({ channel: 'terminal', by: undefined });
    const hubPrompt = historyList.items.find((item) => item.type === 'prompt')!;
    expect(mapHistoryItem(hubPrompt, 'ws_k3m7q2abcdefghij')).toMatchObject({ type: 'prompt', promptId: hubPrompt.id });
  });
});
