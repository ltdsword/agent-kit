import {
  API_PREFIX, ERRORS, PROTOCOL, PROTOCOL_HEADER, USER_ROUTES,
  type DocumentContent, type DocumentMeta, type HubDecision, type HistoryItem,
  type List, type StreamEvent, type UserCommand, type WorkspaceDetail, type WorkspaceSummary,
} from '../protocol';
import type { HubClient } from '../client';
import type { AnswerInput, HubSnapshot, Workspace } from '../types';
import {
  collectPages, mapDecisions, mapDocumentContent, mapHistoryItem, mapPrompt,
  mapWorkspaceDetail, mapWorkspaceSummary,
} from './adapter';
import { NEEDS_YOU } from '../../lib/status';
import { SSEParser } from './sse';

class HubApiError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(code || message);
  }
}

type RequestOptions = { body?: unknown; workspaceId?: string; signal?: AbortSignal };
type RetryableResource = 'decisions' | 'commands' | 'documents' | 'history';

const STREAM_SILENCE_TIMEOUT_MS = 45_000;
const RESOURCE_RETRY_INTERVAL_MS = 5_000;
const ANSWER_CHECK_INTERVAL_MS = 3_000;
const ANSWER_CHECK_ATTEMPTS = 20;

const routePath = (template: string, values: Record<string, string>) => Object.entries(values)
  .reduce((path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)), template.split('?')[0]!);

function withCursor(path: string, cursor: string | null): string {
  const [pathname, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  if (cursor) params.set('cursor', cursor);
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname!;
}

function apiError(res: Response, value: unknown): HubApiError {
  const body = value as { error?: { code?: string; message?: string } };
  const code = body?.error?.code ?? `http_${res.status}`;
  return new HubApiError(code, body?.error?.message ?? res.statusText, res.status);
}

/** Protocol v2 browser client. Wire objects are converted in `adapter.ts`. */
export class HttpHubClient implements HubClient {
  private snap: HubSnapshot = {
    workspaces: [], decisions: [], prompts: [], history: [], documents: [],
    connection: 'live', lastEventAt: Date.now(), loaded: false,
  };
  private listeners = new Set<(s: HubSnapshot) => void>();
  private streams = new Map<string, AbortController>();
  private streamDown = new Set<string>();
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private resourceRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private resourceRetryPending = new Set<string>();
  private workspaceListRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.restartForBrowserEvent();
  };
  private readonly onOnline = () => this.restartForBrowserEvent();

  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string | null,
    private readonly onUnauthorized: () => void,
  ) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    void this.fetchAll();
  }

  subscribe(listener: (s: HubSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): HubSnapshot { return this.snap; }

  async answerDecision(ws: string, run: string, id: string, input: AnswerInput): Promise<void> {
    const path = routePath(USER_ROUTES.answer.path, { ws, run, id });
    try {
      await this.request('POST', path, {
        choice: input.choice,
        note: input.note,
        followup: input.followup,
        value: input.value,
      }, { workspaceId: ws });
    } catch (error) {
      // The answer may have been saved even though its reply was lost on the way back: check before reporting failure.
      if (!(error instanceof HubApiError) || !['computer_timeout', 'hub_unreachable'].includes(error.code)) throw error;
      if (!(await this.confirmAnswered(ws, run, id))) throw new HubApiError('answer_unconfirmed', 'The answer was not confirmed.');
    }
  }

  /** Re-reads the decisions every 3 s for up to 60 s; true once this decision no longer needs an answer. */
  private async confirmAnswered(ws: string, run: string, id: string): Promise<boolean> {
    for (let attempt = 0; attempt < ANSWER_CHECK_ATTEMPTS && !this.disposed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, ANSWER_CHECK_INTERVAL_MS));
      try {
        await this.refreshDecisions(ws);
      } catch {
        continue;
      }
      const decision = this.snap.decisions.find((item) => item.workspaceId === ws && item.runId === run && item.id === id);
      if (decision && !NEEDS_YOU.has(decision.status)) return true;
    }
    return false;
  }

  async replyToDecision(ws: string, run: string, id: string, text: string): Promise<void> {
    await this.request('POST', routePath(USER_ROUTES.reply.path, { ws, run, id }), { text }, { workspaceId: ws });
  }

  async sendPrompt(ws: string, text: string): Promise<void> {
    await this.request('POST', routePath(USER_ROUTES.prompt.path, { ws }), { text }, { workspaceId: ws });
  }

  async resendPrompt(promptId: string): Promise<void> {
    const prompt = this.snap.prompts.find((item) => item.id === promptId);
    if (prompt) await this.sendPrompt(prompt.workspaceId, prompt.text);
  }

  reconnect(): void {
    this.streams.forEach((controller) => controller.abort());
    this.streams.clear();
    this.streamDown.clear();
    this.pollTimers.forEach((timer) => clearInterval(timer));
    this.pollTimers.clear();
    void this.fetchAll();
  }

  private restartForBrowserEvent(): void {
    if (this.disposed) return;
    this.streams.forEach((controller) => controller.abort());
    this.streams.clear();
    this.streamDown.clear();
    this.pollTimers.forEach((timer) => clearInterval(timer));
    this.pollTimers.clear();
    this.syncStreams(this.snap.workspaces);
    void this.fetchAll();
  }

  dispose(): void {
    this.disposed = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    this.streams.forEach((controller) => controller.abort());
    this.streams.clear();
    this.pollTimers.forEach((timer) => clearInterval(timer));
    this.pollTimers.clear();
    this.resourceRetryTimers.forEach((timer) => clearTimeout(timer));
    this.resourceRetryTimers.clear();
    this.resourceRetryPending.clear();
    if (this.workspaceListRetryTimer !== undefined) clearTimeout(this.workspaceListRetryTimer);
    this.workspaceListRetryTimer = undefined;
    this.listeners.clear();
  }

  private emit(patch: Partial<HubSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((listener) => listener(this.snap));
  }

  private headers(json = false): HeadersInit {
    return {
      Authorization: `Bearer ${this.token() ?? ''}`,
      [PROTOCOL_HEADER]: String(PROTOCOL),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new HubApiError('hub_unreachable', 'The hub could not be reached.');
    }
    if (res.status === ERRORS.unauthorized) {
      this.onUnauthorized();
      throw new HubApiError('unauthorized', 'The session expired.', res.status);
    }
    if (!res.ok) {
      const value = await res.json().catch(() => ({}));
      const error = apiError(res, value);
      if (error.code === 'computer_offline' && options.workspaceId) this.markWorkspaceOffline(options.workspaceId);
      // The page was stale (answered elsewhere or by an earlier send): pull the current decision state.
      if (error.code === 'decision_not_answerable' && options.workspaceId) {
        void this.refreshDecisions(options.workspaceId).catch(() => {});
      }
      throw error;
    }
    return res.status === 204 ? undefined as T : await res.json() as T;
  }

  private async list<T>(path: string, workspaceId?: string): Promise<T[]> {
    return collectPages<T>((cursor) => this.request<List>('GET', withCursor(path, cursor), undefined, { workspaceId }));
  }

  private async fetchAll(): Promise<void> {
    if (this.disposed) return;
    try {
      const listPath = `${routePath(USER_ROUTES.workspaces.path, {})}?archived=false`;
      const summaries = await this.list<WorkspaceSummary>(listPath);
      if (this.workspaceListRetryTimer !== undefined) clearTimeout(this.workspaceListRetryTimer);
      this.workspaceListRetryTimer = undefined;
      this.emit({ workspaces: summaries.map((summary) => mapWorkspaceSummary(summary)), loaded: true, lastEventAt: Date.now() });
      this.syncStreams(this.snap.workspaces);
      await Promise.all(summaries.map((summary) => this.refreshWorkspaceAll(summary.id, summary.computer_online)));
      this.setConnection();
    } catch (error) {
      if ((error as Error).message === 'unauthorized' || this.isOffline(error)) return;
      this.emit({ connection: 'lost' });
      if (!this.snap.loaded) this.scheduleWorkspaceListRetry();
    }
  }

  private scheduleWorkspaceListRetry(): void {
    if (this.disposed || this.snap.loaded || this.workspaceListRetryTimer !== undefined) return;
    this.workspaceListRetryTimer = setTimeout(() => {
      this.workspaceListRetryTimer = undefined;
      void this.fetchAll();
    }, RESOURCE_RETRY_INTERVAL_MS);
  }

  private async refreshWorkspaceAll(workspaceId: string, online: boolean): Promise<void> {
    if (!online || this.disposed) return;
    try {
      const detail = await this.request<WorkspaceDetail>('GET', routePath(USER_ROUTES.workspace.path, { ws: workspaceId }), undefined, { workspaceId });
      this.replaceWorkspace(mapWorkspaceDetail(detail));
    } catch (error) {
      if (this.isOffline(error)) return;
      throw error;
    }
    const resources: RetryableResource[] = ['decisions', 'commands', 'documents', 'history'];
    const results = await Promise.allSettled(resources.map((resource) => this.refreshResource(workspaceId, resource)));
    results.forEach((result, index) => {
      const resource = resources[index]!;
      if (result.status === 'fulfilled') {
        this.clearResourceRetry(workspaceId, resource);
      } else if (this.canRetryResource(workspaceId, result.reason)) {
        this.scheduleResourceRetry(workspaceId, resource);
      } else {
        this.clearResourceRetry(workspaceId, resource);
      }
    });
    this.setConnection();
  }

  private refreshResource(workspaceId: string, resource: RetryableResource): Promise<void> {
    if (resource === 'decisions') return this.refreshDecisions(workspaceId);
    if (resource === 'commands') return this.refreshCommands(workspaceId);
    if (resource === 'documents') return this.refreshDocuments(workspaceId);
    return this.refreshHistory(workspaceId);
  }

  private resourceRetryKey(workspaceId: string, resource: RetryableResource): string {
    return `${workspaceId}\0${resource}`;
  }

  private canRetryResource(workspaceId: string, error: unknown): boolean {
    return !this.disposed
      && !(error instanceof HubApiError && error.code === 'unauthorized')
      && this.workspace(workspaceId)?.computerOnline === true;
  }

  private scheduleResourceRetry(workspaceId: string, resource: RetryableResource): void {
    const key = this.resourceRetryKey(workspaceId, resource);
    if (!this.canRetryResource(workspaceId, null)) {
      this.clearResourceRetry(workspaceId, resource);
      this.setConnection();
      return;
    }
    this.resourceRetryPending.add(key);
    if (!this.resourceRetryTimers.has(key)) {
      const timer = setTimeout(() => {
        this.resourceRetryTimers.delete(key);
        if (!this.canRetryResource(workspaceId, null)) {
          this.clearResourceRetry(workspaceId, resource);
          this.setConnection();
          return;
        }
        void this.refreshResource(workspaceId, resource).then(
          () => this.clearResourceRetry(workspaceId, resource),
          (error) => {
            if (this.canRetryResource(workspaceId, error)) this.scheduleResourceRetry(workspaceId, resource);
            else this.clearResourceRetry(workspaceId, resource);
          },
        ).finally(() => this.setConnection());
      }, RESOURCE_RETRY_INTERVAL_MS);
      this.resourceRetryTimers.set(key, timer);
    }
    this.setConnection();
  }

  private clearResourceRetry(workspaceId: string, resource: RetryableResource): void {
    const key = this.resourceRetryKey(workspaceId, resource);
    const timer = this.resourceRetryTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.resourceRetryTimers.delete(key);
    this.resourceRetryPending.delete(key);
  }

  private clearWorkspaceRetries(workspaceId: string): void {
    const prefix = `${workspaceId}\0`;
    for (const key of this.resourceRetryPending) {
      if (key.startsWith(prefix)) {
        const resource = key.slice(prefix.length) as RetryableResource;
        this.clearResourceRetry(workspaceId, resource);
      }
    }
  }

  private async refreshDecisions(workspaceId: string): Promise<void> {
    const path = routePath(USER_ROUTES.decisions.path, { ws: workspaceId });
    const items = await this.list<HubDecision>(path, workspaceId);
    const workspace = this.workspace(workspaceId);
    const mapped = mapDecisions(items, workspace?.status ?? 'OFFLINE');
    this.emit({ decisions: [...this.snap.decisions.filter((item) => item.workspaceId !== workspaceId), ...mapped] });
  }

  private async refreshCommands(workspaceId: string): Promise<void> {
    const items = await this.list<UserCommand>(routePath(USER_ROUTES.commands.path, { ws: workspaceId }), workspaceId);
    const mapped = items.map(mapPrompt).filter((item) => item !== null);
    this.emit({ prompts: [...this.snap.prompts.filter((item) => item.workspaceId !== workspaceId), ...mapped] });
  }

  private async refreshDocuments(workspaceId: string): Promise<void> {
    const path = routePath(USER_ROUTES.documents.path, { ws: workspaceId });
    const metas = await this.list<DocumentMeta>(path, workspaceId);
    const active = metas.filter((meta) => !meta.deleted);
    const documents = await Promise.all(active.map((meta) => {
      const contentPath = `${routePath(USER_ROUTES.document.path, { ws: workspaceId })}?path=${encodeURIComponent(meta.path)}`;
      return this.request<DocumentContent>('GET', contentPath, undefined, { workspaceId });
    }));
    const mapped = documents.map((document) => mapDocumentContent(workspaceId, document));
    this.emit({ documents: [...this.snap.documents.filter((item) => item.workspaceId !== workspaceId), ...mapped] });
  }

  private async refreshHistory(workspaceId: string): Promise<void> {
    const items = await this.list<HistoryItem>(routePath(USER_ROUTES.history.path, { ws: workspaceId }), workspaceId);
    const mapped = items.map((item) => mapHistoryItem(item, workspaceId)).sort((a, b) => b.at - a.at);
    this.emit({ history: [...this.snap.history.filter((item) => item.workspaceId !== workspaceId), ...mapped].sort((a, b) => b.at - a.at) });
  }

  private async refreshEventResource(type: StreamEvent['type'], workspaceId: string): Promise<void> {
    try {
      if (type === 'workspace' || type === 'snapshot') {
        const detail = await this.request<WorkspaceDetail>('GET', routePath(USER_ROUTES.workspace.path, { ws: workspaceId }), undefined, { workspaceId });
        this.replaceWorkspace(mapWorkspaceDetail(detail));
      } else if (type === 'decision') await this.refreshDecisions(workspaceId);
      else if (type === 'command') await this.refreshCommands(workspaceId);
      else if (type === 'document') await this.refreshDocuments(workspaceId);
      else if (type === 'history') await this.refreshHistory(workspaceId);
      this.emit({ lastEventAt: Date.now() });
    } catch (error) {
      if (!this.isOffline(error) && (error as Error).message === 'unauthorized') return;
    }
  }

  private syncStreams(workspaces: Workspace[]): void {
    for (const workspace of workspaces) {
      if (!workspace.computerOnline) this.clearWorkspaceRetries(workspace.id);
    }
    const desired = new Set(workspaces.filter((item) => item.computerOnline && item.computerId).map((item) => item.computerId!));
    for (const [computerId, controller] of this.streams) {
      if (!desired.has(computerId)) {
        controller.abort();
        this.streams.delete(computerId);
        this.clearPoll(computerId);
        this.streamDown.delete(computerId);
      }
    }
    for (const computerId of desired) {
      if (this.streams.has(computerId)) continue;
      const controller = new AbortController();
      this.streams.set(computerId, controller);
      void this.streamLoop(computerId, controller.signal);
    }
    this.setConnection();
  }

  private async streamLoop(computerId: string, signal: AbortSignal): Promise<void> {
    let delay = 1000;
    while (!signal.aborted && !this.disposed) {
      const attemptController = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let rejectSilence!: (error: Error) => void;
      let rejectAbort!: (error: Error) => void;
      const silence = new Promise<never>((_, reject) => { rejectSilence = reject; });
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
      void aborted.catch(() => {});
      const abortAttempt = () => {
        attemptController.abort();
        rejectAbort(new Error('stream_aborted'));
      };
      if (signal.aborted) return;
      signal.addEventListener('abort', abortAttempt, { once: true });
      let failure: unknown;
      try {
        const path = routePath(USER_ROUTES.computerStream.path, { c: computerId });
        const response = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, { headers: this.headers(), signal: attemptController.signal });
        if (response.status === ERRORS.unauthorized) {
          this.onUnauthorized();
          throw new HubApiError('unauthorized', 'The session expired.', response.status);
        }
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const error = apiError(response, body);
          if (error.code === 'computer_offline') {
            this.markComputerOffline(computerId);
            return;
          }
          throw error;
        }
        if (!response.body) throw new HubApiError('empty_stream', 'The event stream had no body.');
        const reconnected = this.streamDown.has(computerId);
        this.streamDown.delete(computerId);
        this.clearPoll(computerId);
        this.setConnection();
        if (reconnected) {
          const workspaces = this.snap.workspaces.filter((item) => item.computerId === computerId);
          void Promise.all(workspaces.map((item) => this.refreshWorkspaceAll(item.id, item.computerOnline))).catch(() => {});
        }
        delay = 1000;
        const parser = new SSEParser();
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const resetWatchdog = () => {
          if (watchdog !== undefined) clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            attemptController.abort();
            rejectSilence(new HubApiError('stream_silent', 'The event stream was silent.'));
          }, STREAM_SILENCE_TIMEOUT_MS);
        };
        resetWatchdog();
        while (!signal.aborted) {
          const { value, done } = await Promise.race([reader.read(), silence, aborted]);
          resetWatchdog();
          const messages = parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }));
          for (const message of messages) {
            try {
              const event = JSON.parse(message.data) as StreamEvent;
              void this.refreshEventResource(message.event as StreamEvent['type'], event.workspace_id);
            } catch { /* Ignore malformed event payloads and keep the stream alive. */ }
          }
          if (done) {
            for (const message of parser.finish()) {
              try {
                const event = JSON.parse(message.data) as StreamEvent;
                void this.refreshEventResource(message.event as StreamEvent['type'], event.workspace_id);
              } catch { /* Ignore malformed event payloads and keep the stream alive. */ }
            }
            throw new HubApiError('stream_closed', 'The event stream closed.');
          }
        }
        return;
      } catch (error) {
        failure = error;
      } finally {
        if (watchdog !== undefined) clearTimeout(watchdog);
        signal.removeEventListener('abort', abortAttempt);
        if (reader) void reader.cancel().catch(() => {});
      }
      if (signal.aborted || this.disposed || (failure as Error)?.message === 'unauthorized') return;
      this.streamDown.add(computerId);
      this.setConnection();
      this.startPoll(computerId);
      await this.wait(delay, signal);
      delay = Math.min(delay * 2, 5_000);
    }
  }

  private startPoll(computerId: string): void {
    if (this.pollTimers.has(computerId)) return;
    this.pollTimers.set(computerId, setInterval(() => {
      const workspaces = this.snap.workspaces.filter((item) => item.computerId === computerId);
      void Promise.all(workspaces.map((item) => this.refreshWorkspaceAll(item.id, item.computerOnline))).catch(() => {});
    }, 10_000));
  }

  private clearPoll(computerId: string): void {
    const timer = this.pollTimers.get(computerId);
    if (timer) clearInterval(timer);
    this.pollTimers.delete(computerId);
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  private markComputerOffline(computerId: string): void {
    const workspaces = this.snap.workspaces.map((workspace) => workspace.computerId === computerId
      ? { ...workspace, computerOnline: false, status: 'OFFLINE' as const }
      : workspace);
    this.emit({ workspaces });
    this.syncStreams(workspaces);
  }

  private markWorkspaceOffline(workspaceId: string): void {
    const workspace = this.workspace(workspaceId);
    if (!workspace) return;
    this.clearWorkspaceRetries(workspaceId);
    const workspaces = this.snap.workspaces.map((item) => item.id === workspaceId
      ? { ...item, computerOnline: false, status: 'OFFLINE' as const }
      : item);
    this.emit({ workspaces });
    if (workspace.computerId) this.syncStreams(workspaces);
    else this.setConnection();
  }

  private replaceWorkspace(detail: Workspace): void {
    // Only the proxy's listing knows which computer a workspace is on; the computer's own detail reply
    // leaves computer_id empty, and dropping it would close the live stream and mark the workspace offline.
    const known = this.workspace(detail.id);
    const workspace = known ? { ...detail, computerId: known.computerId, computerOnline: known.computerOnline } : detail;
    const workspaces = [...this.snap.workspaces.filter((item) => item.id !== workspace.id), workspace];
    this.emit({ workspaces });
    this.syncStreams(workspaces);
  }

  private workspace(id: string): Workspace | undefined {
    return this.snap.workspaces.find((item) => item.id === id);
  }

  private isOffline(error: unknown): boolean {
    return error instanceof HubApiError && error.code === 'computer_offline';
  }

  private setConnection(): void {
    this.emit({ connection: this.streamDown.size || this.resourceRetryPending.size ? 'lost' : 'live' });
  }
}
