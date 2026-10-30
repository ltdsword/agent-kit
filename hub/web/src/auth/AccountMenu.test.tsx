import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { NotificationStatus } from '@/api/protocol';
import { AuthProvider } from './AuthProvider';
import { AccountMenu } from './AccountMenu';
import { MockAuthClient } from './MockAuthClient';

const linkedTarget = {
  id: 'target-1', channel: 'zalo' as const, chat_type: 'private' as const,
  display_name: 'Pat', linked_at: '2026-10-30T00:00:00.000Z', broken: false,
};

function status(overrides: Partial<NotificationStatus> = {}): NotificationStatus {
  return {
    zalo_configured: true,
    bot_link: 'https://zalo.me/demo-bot',
    targets: [],
    sent_this_month: 12,
    monthly_limit: 3000,
    ...overrides,
  };
}

function clientWithStatus(initialStatus: NotificationStatus, expiresInMs = 60_000) {
  const client = new MockAuthClient({ signedIn: true, delay: 0 });
  const getStatus = vi.fn(async () => ({ ...initialStatus, targets: initialStatus.targets.map((target) => ({ ...target })) }));
  const getCode = vi.fn(async () => ({ code: '123456', expires_at: new Date(Date.now() + expiresInMs).toISOString() }));
  const sendTest = vi.fn(async () => {});
  const removeTarget = vi.fn(async (_id: string) => {});
  client.notificationStatus = getStatus;
  client.zaloLinkCode = getCode;
  client.sendTestNotification = sendTest;
  client.removeNotificationTarget = removeTarget;
  return { client, getStatus, getCode, sendTest, removeTarget };
}

function renderAccountMenu(client: MockAuthClient) {
  return render(
    <AuthProvider client={client}>
      <MemoryRouter><AccountMenu /></MemoryRouter>
    </AuthProvider>,
  );
}

async function openNotifications() {
  fireEvent.click(screen.getByRole('button', { name: 'Account: owner' }));
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /Notifications/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('menuitem', { name: /Notifications/ }));
  return screen.findByRole('dialog', { name: 'Notifications' });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AccountMenu notifications', () => {
  it('hides notifications when Zalo is not configured', async () => {
    const { client, getStatus } = clientWithStatus(status({ zalo_configured: false, bot_link: null }));
    renderAccountMenu(client);
    fireEvent.click(screen.getByRole('button', { name: 'Account: owner' }));

    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(screen.queryByRole('menuitem', { name: /Notifications/ })).toBeNull();
  });

  it('shows the bot QR code and link code when no chat is linked', async () => {
    const { client, getCode } = clientWithStatus(status());
    renderAccountMenu(client);
    await openNotifications();

    expect(screen.getByText('1. Open the bot')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR code for Zalo bot' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Zalo' })).toHaveProperty('href', 'https://zalo.me/demo-bot');
    expect((await screen.findByLabelText('Link code')).textContent).toContain('123456');
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Works in a group too/)).toBeTruthy();
  });

  it('lists linked chats, labels broken targets, and calls test and remove', async () => {
    const target = { ...linkedTarget, broken: true };
    const { client, sendTest, removeTarget } = clientWithStatus(status({ targets: [target] }));
    renderAccountMenu(client);
    await openNotifications();

    expect(screen.getByText('Pat')).toBeTruthy();
    expect(screen.getByText(/Private/)).toBeTruthy();
    expect(screen.getByText(/Needs reconnect/)).toBeTruthy();
    expect(screen.getByText('This month: 12 / 3000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(sendTest).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeTarget).toHaveBeenCalledWith('target-1'));
  });

  it('polls and shows the connected name when a target appears', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));
    const unlinked = status();
    const linked = status({ targets: [{ ...linkedTarget, display_name: 'New chat' }] });
    const { client } = clientWithStatus(unlinked);
    let calls = 0;
    client.notificationStatus = vi.fn(async () => {
      calls += 1;
      const current = calls <= 2 ? unlinked : linked;
      return { ...current, targets: current.targets.map((target) => ({ ...target })) };
    });
    renderAccountMenu(client);
    fireEvent.click(screen.getByRole('button', { name: 'Account: owner' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('menuitem', { name: /Notifications/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByText('2. Send this code')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(screen.getByRole('status').textContent).toContain('✅ Connected (New chat)');
    expect(screen.getByText('New chat')).toBeTruthy();
  });

  it('counts down, expires the code, and requests a new one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));
    const { client, getCode } = clientWithStatus(status(), 5000);
    renderAccountMenu(client);
    fireEvent.click(screen.getByRole('button', { name: 'Account: owner' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('menuitem', { name: /Notifications/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByText('expires in 00:05')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('button', { name: 'New code' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New code' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getCode).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Link code').textContent).toContain('123456');
  });
});
