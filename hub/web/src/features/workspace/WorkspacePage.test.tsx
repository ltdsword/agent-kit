import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { MockAuthClient } from '@/auth/MockAuthClient';
import { routes } from '@/App';

let client: MockHubClient;
afterEach(() => client?.dispose());

function renderWorkspace() {
  client = new MockHubClient({ delays: { load: 0 }, heartbeat: false });
  const router = createMemoryRouter(routes, { initialEntries: ['/w/ws_k3m9q2'] });
  render(
    <AuthProvider client={new MockAuthClient({ signedIn: true })}>
      <HubProvider client={client}><RouterProvider router={router} /></HubProvider>
    </AuthProvider>,
  );
  return client;
}

describe('Workspace Decisions and Documents', () => {
  it('shows open decisions first, then all runs newest first with answer details', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const tabs = screen.getByRole('navigation', { name: 'Sections' });
    await user.click(within(tabs).getByRole('button', { name: /Decisions/ }));
    const open = screen.getByRole('group', { name: 'Open decisions' });
    expect(within(open).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/w/ws_k3m9q2/d/r4/D4', '/w/ws_k3m9q2/d/r4/D3',
    ]);

    const all = screen.getByRole('region', { name: 'All decisions' });
    expect(within(all).queryAllByRole('link')).toEqual([]);
    await user.click(within(all).getByRole('button', { name: /All decisions/ }));
    expect(within(all).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/w/ws_k3m9q2/d/r4/D3', '/w/ws_k3m9q2/d/r4/D4',
      '/w/ws_k3m9q2/d/r4/D2', '/w/ws_k3m9q2/d/r3/D4',
    ]);
    expect(within(all).getAllByText('alice')[0]?.parentElement?.parentElement?.textContent).toContain('B: Narrow T4 to the API layer');
    expect(within(all).getByText('Run r3')).toBeTruthy();

    // Category filters: hiding Finish drops the r3 finish decision, the rest stay.
    const filters = within(all).getByRole('group', { name: 'Filter decisions' });
    await user.click(within(filters).getByRole('button', { name: /Finish/ }));
    expect(within(all).getAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain('/w/ws_k3m9q2/d/r3/D4');
    expect(within(all).getAllByRole('link').length).toBe(3);
  });

  it('searches documents by title, path, and run, and filters each kind group', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const docs = screen.getByRole('region', { name: 'Documents' });
    const search = within(docs).getByRole('searchbox', { name: 'Search documents' });
    const docsFilter = within(docs).getByRole('button', { name: 'Docs' });
    const diffsFilter = within(docs).getByRole('button', { name: 'Diffs' });
    const decisionsFilter = within(docs).getByRole('button', { name: 'Decisions' });

    expect(docsFilter.getAttribute('aria-pressed')).toBe('true');
    expect(diffsFilter.getAttribute('aria-pressed')).toBe('true');
    expect(decisionsFilter.getAttribute('aria-pressed')).toBe('true');
    expect(within(docs).getAllByRole('link')[0]?.textContent).toContain('Decision record · D2');

    await user.type(search, '.orchestrator/runs/r4/research/round-2.md');
    expect(within(docs).getByRole('link', { name: /Research dossier · round 2/ })).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'Total diff');
    expect(within(docs).getByRole('link', { name: /Total diff.*Run r3/ })).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'r3');
    expect(within(docs).getAllByRole('link')).toHaveLength(2);
    await user.clear(search);

    await user.click(docsFilter);
    expect(within(docs).queryByText('Research dossier · round 2')).toBeNull();
    expect(within(docs).getByText('Decision record · D2')).toBeTruthy();
    expect(within(docs).getByText('Total diff')).toBeTruthy();
    await user.click(diffsFilter);
    expect(within(docs).getByText('Decision record · D2')).toBeTruthy();
    expect(within(docs).queryByText('Total diff')).toBeNull();
    await user.click(decisionsFilter);
    expect(within(docs).getByText('No documents match your search and filters.')).toBeTruthy();
  });

  it('opens a decision document on its structured page with a Raw file link', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const docs = screen.getByRole('region', { name: 'Documents' });
    await user.click(within(docs).getByRole('link', { name: /Decision record · D2/ }));

    expect(await screen.findByRole('heading', { name: 'Narrow T4 to the API layer?' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /Raw file/ }));
    expect(await screen.findByRole('heading', { name: 'Decision record · D2' })).toBeTruthy();
  });
});
