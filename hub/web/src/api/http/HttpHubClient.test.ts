import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpHubClient } from './HttpHubClient';

const summary = (computerId: string | null) => ({
  id: 'ws_aaaaaaaaaaaaaaaa', name: 'agent-kit', path: null, status: 'ONLINE', last_seen_at: new Date().toISOString(),
  kit_version: null, kit_outdated: false, open_decisions: 0, problems: 0, orchestrator_state: null, active_run: null,
  archived: false, upload: null, orchestrator_last_activity_at: null, computer_id: computerId, computer_online: true,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const installBrowserEvents = () => {
  const doc = new EventTarget();
  Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'visible' });
  const win = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  return { doc, win };
};

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

  it('aborts a silent stream after 45 seconds and reconnects', async () => {
    vi.useFakeTimers();
    let streamAttempts = 0;
    const streamSignals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamAttempts += 1;
        if (init?.signal) streamSignals.push(init.signal);
        const body = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode(': initial keepalive\n\n')); },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(streamAttempts).toBe(1);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(streamSignals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(streamSignals[0]?.aborted).toBe(true);
      expect(streamAttempts).toBe(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(streamAttempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(streamAttempts).toBe(2);
    } finally {
      client.dispose();
    }
  });

  it('keeps a stream alive when keepalive chunks arrive every 20 seconds', async () => {
    vi.useFakeTimers();
    let streamAttempts = 0;
    let streamSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamAttempts += 1;
        streamSignal = init?.signal;
        let timer: ReturnType<typeof setInterval> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            timer = setInterval(() => controller.enqueue(new TextEncoder().encode(': keepalive\n\n')), 20_000);
          },
          cancel() {
            if (timer !== undefined) clearInterval(timer);
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(streamAttempts).toBe(1);
      expect(streamSignal?.aborted).toBe(false);
    } finally {
      client.dispose();
    }
  });

  it('restarts streams and refetches workspaces when visible or back online', async () => {
    vi.useFakeTimers();
    const { doc, win } = installBrowserEvents();
    let streamAttempts = 0;
    let decisionRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamAttempts += 1;
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

      doc.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(streamAttempts).toBe(2);
      expect(decisionRequests).toBe(2);

      win.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(streamAttempts).toBe(3);
      expect(decisionRequests).toBe(3);
    } finally {
      client.dispose();
    }
  });

  it('removes browser event listeners on dispose', async () => {
    vi.useFakeTimers();
    const { doc, win } = installBrowserEvents();
    const removeDocumentListener = vi.spyOn(doc, 'removeEventListener');
    const removeWindowListener = vi.spyOn(win, 'removeEventListener');
    let streamAttempts = 0;
    let decisionRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        streamAttempts += 1;
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
    await vi.advanceTimersByTimeAsync(0);
    client.dispose();
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('online', expect.any(Function));
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(streamAttempts).toBe(1);
    expect(decisionRequests).toBe(1);
  });

  it('retries only the failed panel after 5 seconds', async () => {
    vi.useFakeTimers();
    let decisionRequests = 0;
    let documentRequests = 0;
    const decision = {
      workspace_id: 'ws_aaaaaaaaaaaaaaaa',
      decision: {
        run_id: 'run_1', decision_id: 'd_1', kind: 'question', agent: 'agent', title: 'Retry decision',
        question: 'Continue?', evidence: [], options: [],
      },
      hub_status: 'OPEN',
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/computers/c_1/stream')) {
        return new Response(new ReadableStream<Uint8Array>(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      if (path.endsWith('/decisions')) {
        decisionRequests += 1;
        if (decisionRequests === 1) {
          return new Response(JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          });
        }
        return json({ items: [decision], next: null });
      }
      if (path.endsWith('/documents')) {
        documentRequests += 1;
        return json({ items: [], next: null });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(decisionRequests).toBe(1);
      expect(documentRequests).toBe(1);
      expect(client.getSnapshot().connection).toBe('lost');
      expect(client.getSnapshot().decisions).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(decisionRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(decisionRequests).toBe(2);
      expect(documentRequests).toBe(1);
      expect(client.getSnapshot().decisions.map((item) => item.id)).toEqual(['d_1']);
      expect(client.getSnapshot().connection).toBe('live');
    } finally {
      client.dispose();
    }
  });

  it('retries the initial workspace list after 5 seconds and keeps loading until it succeeds', async () => {
    vi.useFakeTimers();
    let listRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/workspaces') && !path.endsWith('/ws_aaaaaaaaaaaaaaaa')) {
        listRequests += 1;
        if (listRequests === 1) throw new Error('network unavailable');
        return json({ items: [summary('c_1')], next: null });
      }
      if (path.endsWith('/computers/c_1/stream')) {
        return new Response(new ReadableStream<Uint8Array>(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
      }
      return json({ items: [], next: null });
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(listRequests).toBe(1);
      expect(client.getSnapshot().loaded).toBe(false);
      expect(client.getSnapshot().workspaces).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(listRequests).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(listRequests).toBe(2);
      expect(client.getSnapshot().loaded).toBe(true);
      expect(client.getSnapshot().workspaces.map((workspace) => workspace.id)).toEqual(['ws_aaaaaaaaaaaaaaaa']);
    } finally {
      client.dispose();
    }
  });

  it('clears the initial workspace-list retry timer on dispose', async () => {
    vi.useFakeTimers();
    let listRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      listRequests += 1;
      throw new Error('network unavailable');
    }));

    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(listRequests).toBe(1);
    client.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listRequests).toBe(1);
  });
});
