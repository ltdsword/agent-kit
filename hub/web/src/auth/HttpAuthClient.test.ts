import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpAuthClient } from './HttpAuthClient';
import type { Session } from './types';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as Response;
}

const loginResponse = {
  token: 'session-token', expires_at: '2026-10-29T12:00:00.000Z', username: 'alice',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('HttpAuthClient', () => {
  it('logs in through the v2 route and maps the ISO expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, loginResponse));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpAuthClient('https://hub.example');

    await client.signIn('alice', 'secret', true);

    expect(fetchMock).toHaveBeenCalledWith('https://hub.example/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Agent-Hub-Protocol': '2', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username: 'alice', password: 'secret', remember: true }),
    }));
    expect(client.getState()).toMatchObject({ status: 'signed_in', session: { token: 'session-token', expiresAt: Date.parse(loginResponse.expires_at) } });
    expect(localStorage.getItem('agent-hub.session')).not.toBeNull();
  });

  it.each([
    [401, 'invalid_credentials'],
    [429, 'rate_limited'],
  ])('maps login HTTP %s to %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status, { error: { code, message: 'request rejected' } })));
    const client = new HttpAuthClient('https://hub.example');
    await expect(client.signIn('alice', 'wrong', false)).rejects.toThrow(code);
  });

  it('treats a rejected saved session as expired', async () => {
    const saved: Session = {
      user: { username: 'alice', initials: 'A' }, token: 'old-token', expiresAt: Date.now() + 60_000,
    };
    localStorage.setItem('agent-hub.session', JSON.stringify(saved));
    const fetchMock = vi.fn().mockResolvedValue(response(401, { error: { code: 'unauthorized', message: 'expired' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpAuthClient('https://hub.example');

    await waitFor(() => expect(client.getState()).toEqual({ status: 'signed_out', reason: 'expired' }));
    expect(fetchMock).toHaveBeenCalledWith('https://hub.example/api/v1/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer old-token', 'X-Agent-Hub-Protocol': '2' }),
    }));
    expect(localStorage.getItem('agent-hub.session')).toBeNull();
  });

  it('returns current-password and weak-password errors from change password', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, loginResponse))
      .mockResolvedValueOnce(response(401, { error: { code: 'invalid_credentials', message: 'wrong current password' } }))
      .mockResolvedValueOnce(response(422, { error: { code: 'weak_password', message: 'too short' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpAuthClient('https://hub.example');
    await client.signIn('alice', 'secret', false);

    await expect(client.changePassword('wrong', 'a sufficiently long password')).rejects.toThrow('invalid_credentials');
    await expect(client.changePassword('secret', 'short')).rejects.toThrow('weak_password');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://hub.example/api/v1/auth/password', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      body: JSON.stringify({ current: 'wrong', new: 'a sufficiently long password' }),
    }));
  });

  it('calls notification routes with the session token', async () => {
    const status = {
      zalo_configured: true,
      bot_link: 'https://zalo.me/demo-bot',
      targets: [],
      sent_this_month: 3,
      monthly_limit: 3000,
    };
    const code = { code: '123456', expires_at: '2026-10-29T12:10:00.000Z' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, loginResponse))
      .mockResolvedValueOnce(response(200, status))
      .mockResolvedValueOnce(response(200, code))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpAuthClient('https://hub.example');
    await client.signIn('alice', 'secret', false);

    await expect(client.notificationStatus()).resolves.toEqual(status);
    await expect(client.zaloLinkCode()).resolves.toEqual(code);
    await client.sendTestNotification();
    await client.removeNotificationTarget('target /1');

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://hub.example/api/v1/notifications', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer session-token', 'X-Agent-Hub-Protocol': '2' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://hub.example/api/v1/notifications/zalo/code', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://hub.example/api/v1/notifications/test', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'https://hub.example/api/v1/notifications/targets/target%20%2F1', expect.objectContaining({
      method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
  });
});
