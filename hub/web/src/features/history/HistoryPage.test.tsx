import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import type { HubSnapshot } from '@/api/types';
import { HistoryPage } from './HistoryPage';
import { viewHistory } from './HistoryRow';

describe('History Prompts filter', () => {
  it('hides prompt rows by default and shows them when enabled', async () => {
    const user = userEvent.setup();
    const client = new MockHubClient({ delays: { load: 0 }, heartbeat: false });
    const router = createMemoryRouter([{ path: '/w/:wsId/history', element: <HistoryPage /> }], {
      initialEntries: ['/w/ws_k3m9q2/history'],
    });
    render(<HubProvider client={client}><RouterProvider router={router} /></HubProvider>);

    const prompts = await screen.findByRole('button', { name: 'Prompts' });
    await waitFor(() => expect(prompts.getAttribute('aria-pressed')).toBe('false'));
    expect(screen.queryByText('You prompted Opus')).toBeNull();

    await user.click(prompts);
    expect(await screen.findAllByText('You prompted Opus')).toHaveLength(2);
    client.dispose();
  });

  it('labels inbox history as Question and shows held and failed prompt status details', async () => {
    const user = userEvent.setup();
    const client = new MockHubClient({ delays: { load: 0 }, heartbeat: false });
    const snapshot = (client as unknown as { snap: HubSnapshot }).snap;
    snapshot.prompts = [
      { id: 'held-prompt', workspaceId: 'ws_k3m9q2', text: 'held text', status: 'HELD', reason: 'Waiting for the current step.', createdAt: Date.now() },
      { id: 'failed-prompt', workspaceId: 'ws_k3m9q2', text: 'failed text', status: 'FAILED', reason: 'Opus stayed busy for 10 minutes.', createdAt: Date.now() },
    ];
    snapshot.history = [
      { id: 'held-history', workspaceId: 'ws_k3m9q2', at: Date.now(), type: 'prompt', runId: 'inbox', promptId: 'held-prompt' },
      { id: 'failed-history', workspaceId: 'ws_k3m9q2', at: Date.now() - 1, type: 'prompt', runId: 'inbox', promptId: 'failed-prompt' },
    ];
    const router = createMemoryRouter([{ path: '/w/:wsId/history', element: <HistoryPage /> }], {
      initialEntries: ['/w/ws_k3m9q2/history'],
    });
    render(<HubProvider client={client}><RouterProvider router={router} /></HubProvider>);

    await user.click(await screen.findByRole('button', { name: 'Prompts' }));
    expect(await screen.findByText('Waiting for Opus')).toBeTruthy();
    const failedView = viewHistory(snapshot.history[1]!, snapshot);
    expect(failedView.sub).toContain('Question');
    expect(failedView.sub).toContain('Opus stayed busy for 10 minutes.');
    client.dispose();
  });
});
