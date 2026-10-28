/**
 * Domain types shared by the whole UI.
 * They mirror the backend protocol (DECISION-HUB-PLAN.md sections 7.4, 8, 11).
 * When the backend schema changes, change it here first; TypeScript will point at every place to update.
 */

export type WorkspaceStatus = 'RUNNING' | 'OFFLINE' | 'STOPPED';
/** Herdr state of an agent pane. `off` = workspace not running. */
export type AgentLiveState = 'idle' | 'working' | 'blocked' | 'unknown' | 'off';
export type RunStatus = 'RUNNING' | 'DONE' | 'MERGED' | 'BLOCKED' | 'FAILED';
export type GateStatus = 'NOT_RUN' | 'PASSED' | 'FAILED';
export type TaskStatus =
  | 'PENDING' | 'READY' | 'RUNNING' | 'REVIEW' | 'FIX_REQUIRED'
  | 'PASSED' | 'MERGED' | 'BLOCKED' | 'FAILED';
export type WorkerStatus = 'IDLE' | 'BUSY' | 'BLOCKED' | 'BROKEN';

export type DecisionKind =
  | 'blocker' | 'repair' | 'scope_exception' | 'abandon'
  | 'worker_approval' | 'question' | 'finish';

/** Hub-side decision state (plan 7.4), plus REPLY_SENT for "chat something…" replies. */
export type DecisionStatus =
  | 'OPEN' | 'REPLY_SENT' | 'SENT' | 'WAITING' | 'DELIVERED' | 'APPLIED'
  | 'ANSWERED_ELSEWHERE' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED';

export type PromptStatus = 'QUEUED' | 'DELIVERED' | 'HELD' | 'EXPIRED' | 'FAILED';
export type Channel = 'hub' | 'terminal' | 'hub_reply';
export type DeviceKind = 'laptop' | 'phone';

export interface Orchestrator {
  program: string;
  model: string;
  effort: string;
  state: AgentLiveState;
  lastActivityAt: number;
  /** Last lines of the orchestrator pane (opt-in upload). */
  screen?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  worker?: string;
  /** e.g. "1/2" */
  fixRound?: string;
  dependsOn: string[];
}

export interface Worker {
  slot: string;
  status: WorkerStatus;
  taskId?: string;
  live: AgentLiveState;
  sinceAt: number;
  model?: string;
  reason?: string;
  screen?: string;
}

export interface ScoutRound {
  name: string;
  questions: string[];
  docId: string;
}

export interface Scout {
  roundsUsed: number;
  maxRounds: number;
  ready: boolean;
  rounds: ScoutRound[];
}

export interface Problem {
  text: string;
  note: string;
  severity: 'warn' | 'blocked';
  /** Decision id when one is open for it. */
  decisionId?: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  integrationBranch: string;
  gate: GateStatus;
  /** Final outcome text once finished, e.g. "merged into main, pushed". */
  outcome?: string;
  tasks: Task[];
  problems: Problem[];
}

export interface PastRun {
  id: string;
  status: RunStatus;
  outcome: string;
  date: string;
}

export interface UploadSettings {
  documents: boolean;
  diffs: boolean;
  agentScreens: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  status: WorkspaceStatus;
  lastSeenAt: number;
  kitVersion: string;
  archived: boolean;
  uploads: UploadSettings;
  orchestrator: Orchestrator;
  run?: Run;
  pastRuns: PastRun[];
  workers: Worker[];
  scout?: Scout;
}

export interface DecisionOption {
  key: string;
  label: string;
  /** One-line consequence. */
  consequence: string;
}

export interface Evidence {
  code: string;
  note: string;
  bad?: boolean;
}

export interface Answer {
  choice: string;
  label: string;
  note?: string;
  /** Finish decisions: target branch. */
  branch?: string;
  push?: boolean;
  /** The user's own words (terminal answer or chat reply). */
  quote?: string;
  channel: Channel;
  device?: DeviceKind;
  at: number;
}

export interface Decision {
  workspaceId: string;
  runId: string;
  id: string;
  kind: DecisionKind;
  /** Worker slot or 'orchestrator' (where the decision shows inline). */
  agent: string;
  taskId?: string;
  title: string;
  question: string;
  evidence: Evidence[];
  options: DecisionOption[];
  recommend?: string;
  status: DecisionStatus;
  openedAt: number;
  answer?: Answer;
  replyText?: string;
  rejectReason?: string;
  cancelReason?: string;
  supersededBy?: string;
  deliveredAt?: number;
  appliedAt?: number;
  /** Text shown once applied, e.g. "Used by repair --decision D3." */
  appliedNote?: string;
  /** worker_approval only */
  approval?: { command: string; cwd: string; why: string[]; screen?: string };
  /** Opus's short rationale for the recommendation. */
  opusNote?: string;
}

export interface Prompt {
  id: string;
  workspaceId: string;
  text: string;
  status: PromptStatus;
  reason?: string;
  createdAt: number;
}

export type HistoryEntry =
  | {
      id: string; workspaceId: string; at: number; type: 'answer'; runId: string;
      decisionId: string; choice?: string; label?: string; extra?: string;
      /** Typed words: terminal quote or chat reply. */
      quote?: string; replyOnly?: boolean; channel: Channel; device?: DeviceKind; docId?: string;
    }
  | { id: string; workspaceId: string; at: number; type: 'prompt'; runId: string; promptId: string }
  | { id: string; workspaceId: string; at: number; type: 'routine'; runId: string; text: string; reason: string; docId?: string };

export type DocumentKind = 'final_report' | 'final_diff' | 'task_file' | 'decision' | 'research' | 'review';

export interface HubDocument {
  id: string;
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
  name: string;
  title: string;
  format: 'markdown' | 'diff';
  bytes: number;
  truncated: boolean;
  updatedAt: number;
  content: string;
}

export type ConnectionState = 'live' | 'lost';

/** Everything the UI renders. The client pushes a fresh copy on every change. */
export interface HubSnapshot {
  workspaces: Workspace[];
  decisions: Decision[];
  prompts: Prompt[];
  history: HistoryEntry[];
  documents: HubDocument[];
  connection: ConnectionState;
  lastEventAt: number;
  loaded: boolean;
  /** Short message for the toast, set on live events. */
  notice?: { id: number; text: string };
}

export interface AnswerInput {
  choice: string;
  note?: string;
  branch?: string;
}
