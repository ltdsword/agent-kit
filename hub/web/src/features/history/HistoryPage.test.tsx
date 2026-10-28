import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import { HistoryPage } from './HistoryPage';

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
});
