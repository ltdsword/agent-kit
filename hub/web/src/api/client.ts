import type { AnswerInput, HubSnapshot } from './types';

/**
 * The only way the UI talks to a backend.
 * - `MockHubClient` (src/api/mock) runs everything in memory, for development and demos.
 * - `HttpHubClient` (src/api/http) talks to `agent-hub serve` (plan section 11.3).
 * Pick one in `createClient()`; nothing else in the UI changes.
 */
export interface HubClient {
  /** Called with a new snapshot whenever anything changes. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: HubSnapshot) => void): () => void;
  getSnapshot(): HubSnapshot;

  answerDecision(workspaceId: string, runId: string, decisionId: string, input: AnswerInput): Promise<void>;
  replyToDecision(workspaceId: string, runId: string, decisionId: string, text: string): Promise<void>;
  sendPrompt(workspaceId: string, text: string): Promise<void>;
  resendPrompt(promptId: string): Promise<void>;
  reconnect(): void;
  /** Stop timers / streams (e.g. after sign-out). */
  dispose?(): void;
}

/** Optional: only the mock client implements live-event simulation. */
export interface Simulator {
  actions(context: { workspaceId?: string; decisionKey?: string }): { label: string; run: () => void }[];
}

export const PROMPT_LIMIT_BYTES = 8 * 1024;

export function decisionKey(workspaceId: string, runId: string, decisionId: string): string {
  return `${workspaceId}/${runId}/${decisionId}`;
}
