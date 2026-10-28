import type { HubClient } from '../client';
import type { AnswerInput, HubSnapshot } from '../types';

/**
 * Real backend client for `agent-hub serve` (plan section 11.3).
 * Live updates come over Server-Sent Events (`/api/v1/stream`); on any event everything is refetched.
 * If SSE drops it polls every 10 s and reports `connection: 'lost'`.
 * A 401 means the session ended: `onUnauthorized` signs the user out.
 *
 * NOTE: the backend is not built yet (phase H2). Endpoint shapes follow the plan; adjust `fetchAll()`
 * once the real responses exist. The UI does not need to change.
 */
export class HttpHubClient implements HubClient {
  private snap: HubSnapshot = {
    workspaces: [], decisions: [], prompts: [], history: [], documents: [],
    connection: 'live', lastEventAt: Date.now(), loaded: false,
  };
  private listeners = new Set<(s: HubSnapshot) => void>();
  private source?: EventSource;
  private poll?: ReturnType<typeof setInterval>;

  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string | null,
    private readonly onUnauthorized: () => void,
  ) {
    void this.fetchAll();
    this.openStream();
  }

  subscribe(listener: (s: HubSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getSnapshot(): HubSnapshot {
    return this.snap;
  }

  async answerDecision(ws: string, run: string, id: string, input: AnswerInput): Promise<void> {
    await this.request('POST', `/workspaces/${ws}/decisions/${run}/${id}/answer`, {
      choice: input.choice, note: input.note, followup: input.branch ? 'branch' : undefined, value: input.branch,
    });
  }
  async replyToDecision(ws: string, run: string, id: string, text: string): Promise<void> {
    await this.request('POST', `/workspaces/${ws}/decisions/${run}/${id}/reply`, { text });
  }
  async sendPrompt(ws: string, text: string): Promise<void> {
    await this.request('POST', `/workspaces/${ws}/prompts`, { text });
  }
  async resendPrompt(promptId: string): Promise<void> {
    const p = this.snap.prompts.find((x) => x.id === promptId);
    if (p) await this.sendPrompt(p.workspaceId, p.text);
  }
  reconnect(): void {
    this.source?.close();
    this.openStream();
    void this.fetchAll();
  }
  dispose(): void {
    this.source?.close();
    if (this.poll) clearInterval(this.poll);
    this.listeners.clear();
  }

  /* ---------- internals ---------- */

  private emit(patch: Partial<HubSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l(this.snap));
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token() ?? ''}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('hub_unreachable');
    }
    if (res.status === 401) {
      this.onUnauthorized();
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `${res.status} ${res.statusText}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  /** Simplest correct strategy: refetch everything. Optimise per event type later if needed. */
  private async fetchAll(): Promise<void> {
    try {
      const workspaces = await this.request<HubSnapshot['workspaces']>('GET', '/workspaces');
      const perWs = await Promise.all(workspaces.map(async (w) => {
        const [detail, decisions, commands, documents, history] = await Promise.all([
          this.request<HubSnapshot['workspaces'][number]>('GET', `/workspaces/${w.id}`),
          this.request<HubSnapshot['decisions']>('GET', `/workspaces/${w.id}/decisions`),
          this.request<HubSnapshot['prompts']>('GET', `/workspaces/${w.id}/commands`),
          this.request<HubSnapshot['documents']>('GET', `/workspaces/${w.id}/documents`),
          this.request<HubSnapshot['history']>('GET', `/workspaces/${w.id}/history`),
        ]);
        return { detail, decisions, commands, documents, history };
      }));
      this.emit({
        workspaces: perWs.map((x) => x.detail),
        decisions: perWs.flatMap((x) => x.decisions),
        prompts: perWs.flatMap((x) => x.commands),
        documents: perWs.flatMap((x) => x.documents),
        history: perWs.flatMap((x) => x.history).sort((a, b) => b.at - a.at),
        loaded: true, lastEventAt: Date.now(),
      });
    } catch (e) {
      if ((e as Error).message !== 'unauthorized') this.emit({ connection: 'lost', loaded: true });
    }
  }

  private openStream(): void {
    // EventSource can't send headers, so the token goes in the query string (backend must accept it there for /stream only).
    const url = `${this.baseUrl}/api/v1/stream?token=${encodeURIComponent(this.token() ?? '')}`;
    this.source = new EventSource(url);
    this.source.onopen = () => {
      if (this.poll) clearInterval(this.poll);
      this.poll = undefined;
      this.emit({ connection: 'live', lastEventAt: Date.now() });
    };
    this.source.onmessage = () => void this.fetchAll();
    this.source.onerror = () => {
      this.emit({ connection: 'lost' });
      if (!this.poll) this.poll = setInterval(() => void this.fetchAll(), 10_000);
    };
  }
}
