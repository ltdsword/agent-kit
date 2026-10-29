import { afterEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { MockAuthClient } from '@/auth/MockAuthClient';
import { routes } from '@/App';
import type { Decision } from '@/api/types';
import { branchError, useDecisionForm } from './useDecisionForm';

let client: MockHubClient;
afterEach(() => client?.dispose());

function renderAt(path: string) {
  client = new MockHubClient({ delays: { load: 0, deliver: 20, apply: 20, prompt: 20, reply: 5000, finish: 20 }, heartbeat: false });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider client={new MockAuthClient({ signedIn: true })}>
      <HubProvider client={client}><RouterProvider router={router} /></HubProvider>
    </AuthProvider>,
  );
  return client;
}

describe('Decision screen', () => {
  it('shows the recommended option first and needs a choice before review', async () => {
    renderAt('/w/ws_k3m9q2/d/r4/D3');
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveProperty('value', 'A');
    expect(screen.getByText('Recommended by Opus')).toBeTruthy();
    expect((screen.getByRole('button', { name: /choose an option/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms, sends, and shows the status stepper', async () => {
    const user = userEvent.setup();
    const c = renderAt('/w/ws_k3m9q2/d/r4/D3');
    await user.click(screen.getByLabelText(/drop t2’s name change/i));
    await user.type(screen.getByLabelText(/note for opus/i), 'keep wording');
    await user.click(screen.getByRole('button', { name: /review answer b/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('“keep wording”')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /send answer b/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Delivery status')).toBeTruthy();
    expect(c.getSnapshot().decisions.find((d) => d.id === 'D3')!.answer!.note).toBe('keep wording');
  });

  it('tells the user when Opus cancels the decision while they read it', async () => {
    const c = renderAt('/w/ws_k3m9q2/d/r4/D3');
    act(() => c.actions({ decisionKey: 'ws_k3m9q2/r4/D3' }).find((a) => a.label.startsWith('Opus cancels'))!.run());
    expect(await screen.findByText(/while you were reading/i)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('sends a "chat something" reply without choosing an option', async () => {
    const user = userEvent.setup();
    const c = renderAt('/w/ws_k3m9q2/d/r4/D3');
    await user.click(screen.getByRole('button', { name: /chat something/i }));
    await user.type(screen.getByLabelText(/reply to opus instead/i), 'rebase, keep T1 wording');
    await user.click(screen.getByRole('button', { name: /send reply to opus/i }));
    expect(c.getSnapshot().decisions.find((d) => d.id === 'D3')!.status).toBe('REPLY_SENT');
    // The reply gets its own status card at the top, like an answer's Sent screen.
    expect(await screen.findByText(/your reply: “rebase, keep T1 wording”/i)).toBeTruthy();
    expect(screen.getByRole('list', { name: /delivery status/i })).toBeTruthy();
  });
});

describe('branchError', () => {
  it('blocks agent/ branches and empty names', () => {
    expect(branchError('agent/x')).toMatch(/reserved/);
    expect(branchError('  ')).toMatch(/type a branch/i);
    expect(branchError('release/v2')).toBeNull();
  });
});

describe('finish followup', () => {
  const finish = {
    workspaceId: 'ws', runId: 'hub6', id: 'D1', kind: 'finish', agent: 'orchestrator', title: 'Merge run hub6?',
    question: 'q', evidence: [], status: 'OPEN', openedAt: 0,
    options: [{ key: 'A', label: 'Merge and push', consequence: '' }, { key: 'B', label: 'Merge locally', consequence: '' },
      { key: 'C', label: 'Don’t merge', consequence: '' }],
    followup: { when: ['A', 'B'], question: 'Which branch?', options: [
      { key: 'A', label: 'This branch (hub/plan)', value: 'hub/plan' },
      { key: 'B', label: 'Other branch', input: true },
    ] },
  } as Decision;

  it('sends the decision’s own followup keys, with a value only for the typed option', () => {
    const { result, rerender } = renderHook(() => useDecisionForm(finish));
    act(() => result.current.pick('B'));
    rerender();
    expect(result.current.thisBranch).toBe('hub/plan');
    expect(result.current.toInput()).toEqual({ choice: 'B', note: undefined, branch: 'hub/plan', followup: 'A', value: undefined });
    act(() => { result.current.setBranchMode('other'); result.current.setBranchText('release/x'); });
    expect(result.current.toInput()).toMatchObject({ branch: 'release/x', followup: 'B', value: 'release/x' });
    act(() => result.current.pick('C'));
    expect(result.current.toInput()).toMatchObject({ followup: undefined, value: undefined, branch: undefined });
  });
});
