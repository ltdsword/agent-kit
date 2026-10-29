/** UI model adapted from the protocol v2 wire types in `@agent-hub/protocol`. */

export type WorkspaceStatus = 'RUNNING' | 'OFFLINE' | 'STOPPED';
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
export type DecisionStatus =
  | 'OPEN' | 'SENT' | 'WAITING' | 'REPLY_SENT' | 'DELIVERED' | 'APPLIED'
  | 'ANSWERED_ELSEWHERE' | 'REJECTED' | 'CANCELLED' | 'ROUTINE';
export type PromptStatus = 'QUEUED' | 'DELIVERED' | 'HELD' | 'EXPIRED' | 'FAILED';
export type Channel = 'hub' | 'terminal' | 'routine';

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
  summary: string;
  status: TaskStatus;
  worker?: string;
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
  decisionId?: string;
}

export interface Run {
  id: string;
  title: string;
  goal: string;
  status: RunStatus;
  integrationBranch: string;
  gate: GateStatus;
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
  orchestratorScreen: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  status: WorkspaceStatus;
  lastSeenAt: number;
  kitVersion: string;
  archived: boolean;
  computerId: string | null;
  computerOnline: boolean;
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
  consequence: string;
}

/** Second question a decision asks for some choices (finish: which branch). */
export interface FollowupOption {
  key: string;
  label: string;
  value?: string;
  input?: boolean;
}

export interface Followup {
  when: string[];
  question: string;
  options: FollowupOption[];
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
  branch?: string;
  push?: boolean;
  quote?: string;
  channel: Channel;
  by?: string;
  at: number;
}

export interface Decision {
  workspaceId: string;
  runId: string;
  id: string;
  kind: DecisionKind;
  agent: string;
  taskId?: string;
  title: string;
  question: string;
  evidence: Evidence[];
  options: DecisionOption[];
  followup?: Followup;
  recommend?: string;
  status: DecisionStatus;
  openedAt: number;
  answer?: Answer;
  replyText?: string;
  rejectReason?: string;
  cancelReason?: string;
  deliveredAt?: number;
  appliedAt?: number;
  appliedNote?: string;
  approval?: { command: string; cwd: string | null; why: string[] };
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
      quote?: string; replyOnly?: boolean; channel: Channel; by?: string; docId?: string;
    }
  | { id: string; workspaceId: string; at: number; type: 'prompt'; runId: string; promptId: string; by?: string }
  | { id: string; workspaceId: string; at: number; type: 'routine'; runId: string; text: string; reason: string; docId?: string };

export type DocumentKind = 'final_report' | 'final_diff' | 'decision' | 'research' | 'plan' | 'review' | 'other';

export interface HubDocument {
  id: string;
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
  name: string;
  title: string;
  format: 'markdown' | 'diff' | 'text';
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
  notice?: { id: number; text: string };
}

export interface AnswerInput {
  choice: string;
  note?: string;
  /** Resulting branch, for display and the mock. */
  branch?: string;
  /** Followup option key and, for a typed option, the typed value: sent as-is to the hub. */
  followup?: string;
  value?: string;
}
