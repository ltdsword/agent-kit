import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Clients } from '@/api';
import { MockHubClient } from '@/api/mock/MockHubClient';
import { AppRoot } from '@/AppRoot';
import { MockAuthClient } from './MockAuthClient';

function setup(path = '/') {
  window.location.hash = path;
  const auth = new MockAuthClient({ delay: 0 });
  const clients: Clients = { auth, createHub: () => new MockHubClient({ delays: { load: 0 }, heartbeat: false }) };
  render(<AppRoot clients={clients} />);
  return auth;
}

describe('Sign in', () => {
  it('shows only the login page when signed out', async () => {
    setup('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Workspaces')).toBeNull();
  });

  it('rejects a wrong password and clears it', async () => {
    const user = userEvent.setup();
    setup('/');
    await user.type(await screen.findByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong username or password.')).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('signs in, lands on the page it was opened at, and signs out', async () => {
    const user = userEvent.setup();
    setup('/w/ws_k3m9q2');
    await user.type(await screen.findByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), MockAuthClient.DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'thrift-demo' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /account: owner/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Change password' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /account: owner/i }));
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(await screen.findByText('You signed out of this browser.')).toBeTruthy();
  });

  it('explains an expired session', async () => {
    const auth = setup('/');
    act(() => auth.signOut('expired'));
    expect(await screen.findByText(/session expired/i)).toBeTruthy();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    setup('/');
    const pass = (await screen.findByLabelText('Password')) as HTMLInputElement;
    expect(pass.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pass.type).toBe('text');
  });
});
