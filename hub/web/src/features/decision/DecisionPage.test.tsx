import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { MockAuthClient } from '@/auth/MockAuthClient';
import { routes } from '@/App';
import { branchError } from './useDecisionForm';

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
    expect(await screen.findByText(/reply sent\./i)).toBeTruthy();
  });
});

describe('branchError', () => {
  it('blocks agent/ branches and empty names', () => {
    expect(branchError('agent/x')).toMatch(/reserved/);
    expect(branchError('  ')).toMatch(/type a branch/i);
    expect(branchError('release/v2')).toBeNull();
  });
});
