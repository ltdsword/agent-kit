import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { HubProvider } from '@/state/HubProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { MockAuthClient } from '@/auth/MockAuthClient';
import { routes } from '@/App';
import type { Decision, HistoryEntry, HubDocument, HubSnapshot } from '@/api/types';
import { viewHistory } from '@/features/history/HistoryRow';

let client: MockHubClient;
afterEach(() => client?.dispose());

function renderWorkspace(prepare?: (snapshot: HubSnapshot) => void) {
  client = new MockHubClient({ delays: { load: 0 }, heartbeat: false });
  prepare?.((client as unknown as { snap: HubSnapshot }).snap);
  const router = createMemoryRouter(routes, { initialEntries: ['/w/ws_k3m9q2'] });
  render(
    <AuthProvider client={new MockAuthClient({ signedIn: true })}>
      <HubProvider client={client}><RouterProvider router={router} /></HubProvider>
    </AuthProvider>,
  );
  return client;
}

function document(id: string, kind: HubDocument['kind'], title: string, index: number): HubDocument {
  return {
    id, workspaceId: 'ws_k3m9q2', runId: 'r9', kind, name: `${id}.md`, title,
    format: 'markdown', bytes: 12, truncated: false, updatedAt: Date.now() - index, content: title,
  };
}

function decision(id: string, runId: string, status: Decision['status'] = 'APPLIED', index = 0): Decision {
  return {
    workspaceId: 'ws_k3m9q2', runId, id, kind: 'question', agent: 'orchestrator', title: `Question ${id}`,
    question: `Question text ${id}`, evidence: [], options: [{ key: 'A', label: 'Yes', consequence: 'Proceed.' }],
    recommend: 'A', status, openedAt: Date.now() - index,
  };
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
    const runFilter = within(docs).getByRole('button', { name: 'Run' });
    const planFilter = within(docs).getByRole('button', { name: 'Plan' });
    const otherFilter = within(docs).getByRole('button', { name: 'Other' });

    expect(runFilter.getAttribute('aria-pressed')).toBe('false');
    expect(planFilter.getAttribute('aria-pressed')).toBe('false');
    expect(otherFilter.getAttribute('aria-pressed')).toBe('false');
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

    await user.click(runFilter);
    const runKinds = within(docs).getByRole('group', { name: 'Run document kinds' });
    expect(within(runKinds).getByRole('button', { name: 'Final report' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(runKinds).getByRole('button', { name: 'Scout' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(runFilter);
    expect(within(docs).getByText('Decision record · D2')).toBeTruthy();
    await user.click(planFilter);
    expect(within(docs).getByText('No documents match your search and filters.')).toBeTruthy();
    await user.click(planFilter);
    await user.click(otherFilter);
    expect(within(docs).getByText('No documents match your search and filters.')).toBeTruthy();
    await user.click(otherFilter);
    await user.click(runFilter);
    const allRunKinds = within(docs).getByRole('group', { name: 'Run document kinds' });
    for (const label of ['Final report', 'Diff', 'Decisions', 'Scout']) await user.click(within(allRunKinds).getByRole('button', { name: label }));
    expect(within(docs).getByText('No documents match your search and filters.')).toBeTruthy();
  });

  it('combines Run kinds with Plan and includes only the selected kinds', async () => {
    const user = userEvent.setup();
    renderWorkspace((snapshot) => {
      snapshot.documents.push(
        document('plan-example', 'plan', 'Example plan', 1),
        document('review-example', 'review', 'Example review', 2),
        document('other-example', 'other', 'Example other', 3),
      );
    });
    const docs = screen.getByRole('region', { name: 'Documents' });
    await user.click(within(docs).getByRole('button', { name: 'Run' }));
    const runKinds = within(docs).getByRole('group', { name: 'Run document kinds' });
    await user.click(within(runKinds).getByRole('button', { name: 'Diff' }));
    await user.click(within(runKinds).getByRole('button', { name: 'Decisions' }));
    await user.click(within(docs).getByRole('button', { name: 'Plan' }));

    expect(within(docs).getByRole('link', { name: /Final report.*Run r3/ })).toBeTruthy();
    expect(within(docs).getByText('Research dossier · round 2')).toBeTruthy();
    expect(within(docs).getByText('Example plan')).toBeTruthy();
    expect(within(docs).queryByText('Total diff')).toBeNull();
    expect(within(docs).queryByText('Decision record · D2')).toBeNull();
    expect(within(docs).queryByText('Example review')).toBeNull();
    expect(within(docs).queryByText('Example other')).toBeNull();
  });

  it('shows inbox decisions only in Questions and labels their ids Q<n>', async () => {
    const user = userEvent.setup();
    renderWorkspace((snapshot) => {
      snapshot.decisions.push(decision('D10', 'inbox', 'OPEN'));
      const workspace = snapshot.workspaces.find((item) => item.id === 'ws_k3m9q2')!;
      workspace.run = { ...workspace.run!, id: 'inbox', title: 'inbox' };
      workspace.pastRuns.push({ id: 'inbox', status: 'DONE', outcome: '', date: '' });
    });
    const questions = screen.getByRole('region', { name: 'Questions' });
    expect(within(questions).getByText('Q10')).toBeTruthy();
    expect(within(questions).getByRole('link', { name: /Question D10/ }).getAttribute('href')).toBe('/w/ws_k3m9q2/d/inbox/D10');
    expect(screen.getByText('No active run.')).toBeTruthy();
    expect(screen.queryByText('Run inbox')).toBeNull();

    const tabs = screen.getByRole('navigation', { name: 'Sections' });
    await user.click(within(tabs).getByRole('button', { name: /^Decisions/ }));
    expect(screen.queryByText('Question D10')).toBeNull();
    await user.click(within(tabs).getByRole('button', { name: /^Questions/ }));
    expect(screen.getByText('Question D10')).toBeTruthy();
    expect(within(tabs).getByRole('button', { name: /Questions1/ })).toBeTruthy();
  });

  it('shows 15 documents in Everything and More opens the paged Documents tab', async () => {
    const user = userEvent.setup();
    renderWorkspace((snapshot) => {
      snapshot.documents = Array.from({ length: 16 }, (_, index) => document(`doc-${index}`, 'other', `Document ${index}`, index));
    });
    let docs = screen.getByRole('region', { name: 'Documents' });
    expect(within(docs).getAllByRole('link')).toHaveLength(15);
    await user.click(within(docs).getByRole('button', { name: '→ More…' }));
    const tabs = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(tabs).getByRole('button', { name: 'Documents' }).getAttribute('aria-pressed')).toBe('true');
    docs = screen.getByRole('region', { name: 'Documents' });
    expect(within(docs).getAllByRole('link')).toHaveLength(16);
    expect(within(docs).getByText('page 1 of 1')).toBeTruthy();
  });

  it('shows 15 decisions in Everything and More opens the full Decisions list', async () => {
    const user = userEvent.setup();
    renderWorkspace((snapshot) => {
      snapshot.decisions = Array.from({ length: 16 }, (_, index) => decision(`D${index + 1}`, 'r9', 'APPLIED', index));
    });
    const decisions = screen.getByRole('region', { name: 'Decisions' });
    const all = within(decisions).getByRole('region', { name: 'All decisions' });
    expect(within(all).getAllByRole('link')).toHaveLength(15);
    await user.click(within(decisions).getByRole('button', { name: '→ More…' }));
    expect(within(all).getAllByRole('link')).toHaveLength(16);
    expect(within(all).getByText('page 1 of 1')).toBeTruthy();
  });

  it('shows 15 Questions in Everything and More opens the full Questions list', async () => {
    const user = userEvent.setup();
    renderWorkspace((snapshot) => {
      snapshot.decisions = Array.from({ length: 16 }, (_, index) => decision(`D${index + 1}`, 'inbox', 'OPEN', index));
    });
    const questions = screen.getByRole('region', { name: 'Questions' });
    expect(within(questions).getAllByRole('link')).toHaveLength(15);
    await user.click(within(questions).getByRole('button', { name: '→ More…' }));
    expect(within(questions).getAllByRole('link')).toHaveLength(16);
    expect(within(questions).getByText('page 1 of 1')).toBeTruthy();
  });

  it('shows 15 History rows in Everything, opens History with More, and labels inbox rows Question', async () => {
    const user = userEvent.setup();
    const renderedClient = renderWorkspace((snapshot) => {
      snapshot.history = Array.from({ length: 16 }, (_, index): HistoryEntry => ({
        id: `inbox-history-${index}`, workspaceId: 'ws_k3m9q2', at: Date.now() - index,
        type: 'answer', runId: 'inbox', decisionId: `D${index + 1}`, choice: 'A', label: `Answer ${index + 1}`, channel: 'hub',
      }));
    });
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByText('You chose A: Answer 1')).toBeTruthy();
    expect(within(history).queryByText('You chose A: Answer 16')).toBeNull();
    expect(within(history).getAllByText('Question')).toHaveLength(15);
    await user.click(within(history).getByRole('button', { name: '→ More…' }));

    expect(viewHistory(renderedClient.getSnapshot().history[0]!, renderedClient.getSnapshot()).sub).toContain('Question');
    expect(await screen.findByText('You chose A: Answer 16')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Question' })).toBeTruthy();
    expect(screen.getByText('page 1 of 1')).toBeTruthy();
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
