import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpHubClient } from './HttpHubClient';

const summary = (computerId: string | null) => ({
  id: 'ws_aaaaaaaaaaaaaaaa', name: 'agent-kit', path: null, status: 'ONLINE', last_seen_at: new Date().toISOString(),
  kit_version: null, kit_outdated: false, open_decisions: 0, problems: 0, orchestrator_state: null, active_run: null,
  archived: false, upload: null, orchestrator_last_activity_at: null, computer_id: computerId, computer_online: true,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('HttpHubClient', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('keeps the computer from the listing when a workspace detail refresh arrives, so the live stream stays open', async () => {
    let streamSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamSignal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const event = { type: 'workspace', workspace_id: 'ws_aaaaaaaaaaaaaaaa', at: new Date().toISOString(), ref: 'ws_aaaaaaaaaaaaaaaa' };
            controller.enqueue(new TextEncoder().encode(`event: workspace\ndata: ${JSON.stringify(event)}\n\n`));
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
      // The computer's own detail reply does not know which computer it is on.
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.waitFor(() => expect(streamSignal).toBeDefined());
      await new Promise((resolve) => setTimeout(resolve, 50));
      const workspace = client.getSnapshot().workspaces[0];
      expect(workspace?.computerId).toBe('c_1');
      expect(workspace?.computerOnline).toBe(true);
      expect(streamSignal?.aborted).toBe(false);
    } finally {
      client.dispose();
    }
  });

  it('retries a failed stream within 3 seconds and refreshes decisions after reconnecting', async () => {
    vi.useFakeTimers();
    let streamAttempts = 0;
    let decisionRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamAttempts += 1;
        if (streamAttempts < 3) throw new Error('stream unavailable');
        return new Response(new ReadableStream<Uint8Array>(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      if (path.endsWith('/decisions')) {
        decisionRequests += 1;
        return json({ items: [], next: null });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(streamAttempts).toBe(1);
      expect(decisionRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(streamAttempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(streamAttempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(streamAttempts).toBe(3);
      await vi.waitFor(() => expect(decisionRequests).toBe(2));
    } finally {
      client.dispose();
    }
  });
});
