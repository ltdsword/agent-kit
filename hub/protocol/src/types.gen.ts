/* Generated from schemas/protocol.schema.json by scripts/gen-types.ts. Do not edit. */

export type Timestamp = string;
export type NullableTimestamp = string | null;
export type WorkspaceId = string;
export type RunId = string;
export type TaskId = string;
export type Username = string;
export type ComputerId = string;
export type DecisionId = string;
export type Sha256 = string;
export type OptionKey = string;
export type WorkspaceStatus = "ONLINE" | "OFFLINE" | "STOPPED";
export type RunStatus = "RUNNING" | "DONE" | "BLOCKED" | "FAILED";
export type TaskStatus =
  "PENDING" | "READY" | "RUNNING" | "REVIEW" | "FIX_REQUIRED" | "PASSED" | "MERGED" | "BLOCKED" | "FAILED";
export type WorkerStatus = "IDLE" | "BUSY" | "BLOCKED" | "BROKEN";
export type AgentState = "idle" | "working" | "blocked" | "done" | "unknown" | "absent";
export type DecisionKind =
  "blocker" | "repair" | "scope_exception" | "abandon" | "worker_approval" | "question" | "finish";
export type LocalDecisionStatus = "PENDING" | "ANSWERED" | "CANCELLED" | "DECIDED_BY_OPUS";
export type HubDecisionStatus =
  | "OPEN"
  | "SENT"
  | "REPLY_SENT"
  | "DELIVERED"
  | "APPLIED"
  | "ANSWERED_ELSEWHERE"
  | "REJECTED"
  | "CANCELLED"
  | "ROUTINE";
export type AnswerChannel = "chat" | "hub" | "opus";
export type CommandType = "answer" | "reply" | "prompt";
export type CommandStatus = "QUEUED" | "HELD" | "DELIVERED" | "REJECTED" | "FAILED" | "EXPIRED";
export type AckStatus = "DELIVERED" | "HELD" | "REJECTED" | "FAILED";
export type DocumentKind = "final_report" | "final_diff" | "decision" | "research";
export type DocumentFormat = "markdown" | "diff" | "text";

/**
 * Single source of truth for the connector API (agentctl <-> backend), the browser API (web UI <-> proxy), and the relay frames (proxy <-> backend). Uses only this JSON Schema subset so the stdlib Python validator can check it: type (string or list), enum, const, required, properties, additionalProperties (boolean or schema), items, minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, $ref to #/$defs/*, anyOf (only for nullable refs). No oneOf/allOf/format.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
/**
 * The orchestrator. name = kitstart.agent_name(repo). screen = last lines of its pane (null when upload.orchestrator_screen is off).
 */
export interface Agent {
  name: string;
  kind: string;
  model: string;
  effort: string | null;
  herdr_state: AgentState;
  session_id: string | null;
  /**
   * @maxItems 200
   */
  screen: string[] | null;
}
export interface Worker {
  slot: string;
  status: WorkerStatus;
  status_reason: string | null;
  run_id: string | null;
  task_id: string | null;
  agent_name: string | null;
  kind: string;
  model: string;
  effort: string | null;
  herdr_state: AgentState;
  since: NullableTimestamp;
}
export interface ScoutRound {
  n: number;
  /**
   * @maxItems 50
   */
  questions: string[];
  evidence_path: string | null;
  at: NullableTimestamp;
}
/**
 * Research rounds of the active run (the scout is a Claude subagent inside the orchestrator; no live pane).
 */
export interface Scout {
  run_id: RunId;
  rounds_used: number;
  max_rounds: number;
  readiness: "READY" | "NOT_READY" | null;
  /**
   * @maxItems 20
   */
  rounds: ScoutRound[];
}
export interface Task {
  id: TaskId;
  title: string;
  summary: string | null;
  status: TaskStatus;
  worker: string | null;
  /**
   * @maxItems 20
   */
  depends_on: TaskId[];
  major_repairs: number;
  max_repairs: number;
  known_issues: string | null;
}
export interface Problem {
  task_id: string | null;
  type: string;
  since: NullableTimestamp;
  decision_id: string | null;
  note: string;
}
export interface Finish {
  decision_id: DecisionId;
  choice: OptionKey;
  result: string;
  branch: string | null;
  pushed: boolean | null;
  at: Timestamp;
}
export interface Run {
  run_id: RunId;
  title: string | null;
  goal: string | null;
  status: RunStatus;
  created_at: NullableTimestamp;
  base_branch: string | null;
  integration_branch: string;
  gate: {
    status: "PASS" | "FAIL" | null;
    at: NullableTimestamp;
  };
  /**
   * @maxItems 20
   */
  tasks: Task[];
  /**
   * @maxItems 50
   */
  problems: Problem[];
  report_path: string | null;
  finish: Finish | null;
}
/**
 * The whole live status of one workspace. Overwrites the previous one. Max 256 KB serialized.
 */
export interface Snapshot {
  protocol: 2;
  workspace_id: WorkspaceId;
  session_id: string;
  taken_at: Timestamp;
  kit_version: string | null;
  orchestrator: Agent;
  /**
   * @maxItems 10
   */
  workers: Worker[];
  scout: Scout | null;
  /**
   * @maxItems 200
   */
  runs: Run[];
  orchestrator_last_activity_at: NullableTimestamp;
}
export interface Option {
  key: OptionKey;
  label: string;
  consequence: string | null;
}
export interface Evidence {
  code: string;
  note: string;
  bad: boolean;
}
export interface Approval {
  command: string;
  cwd: string | null;
  /**
   * @maxItems 10
   */
  why: string[];
}
export interface FollowupOption {
  key: OptionKey;
  label: string;
  value: string | null;
  input: boolean;
}
/**
 * Second question asked when the first choice is in `when` (finish: which branch). An option with input=true takes a typed value.
 */
export interface Followup {
  /**
   * @minItems 1
   */
  when: [OptionKey, ...OptionKey[]];
  question: string;
  /**
   * @minItems 1
   * @maxItems 8
   */
  options: [FollowupOption, ...FollowupOption[]];
  validate: "branch" | null;
}
export interface FollowupAnswer {
  choice: OptionKey;
  label: string;
  value: string;
}
/**
 * Mirrors state.json decisions[D].answer. channel=opus for routine decisions.
 */
export interface Answer {
  choice: string;
  label: string;
  note: string;
  channel: AnswerChannel;
  by: string;
  at: Timestamp;
  quote: string | null;
  followup: FollowupAnswer | null;
}
/**
 * One scheduler decision as the connector sees it in state.json. agent = the worker slot holding task_id, else 'orchestrator'.
 */
export interface Decision {
  run_id: RunId;
  decision_id: DecisionId;
  kind: DecisionKind;
  task_id: string | null;
  agent: string;
  title: string;
  question: string;
  /**
   * @maxItems 8
   */
  options: Option[];
  recommend: string | null;
  followup: Followup | null;
  local_status: LocalDecisionStatus;
  answer: Answer | null;
  consumed_by: string | null;
  opened_at: Timestamp;
  cancel_reason: string | null;
  /**
   * @maxItems 20
   */
  evidence: Evidence[];
  note: string | null;
  approval: Approval | null;
}
/**
 * One state.json event. n = per-run increasing number (log_event).
 */
export interface Event {
  n: number;
  at: Timestamp;
  kind: string;
  data: {};
}
export interface Document {
  path: string;
  run_id: string | null;
  kind: DocumentKind;
  title: string;
  format: DocumentFormat;
  sha256: Sha256;
  bytes: number;
  truncated: boolean;
  content: string;
}
/**
 * answer: choice (+note, followup, value). reply/prompt: text.
 */
export interface CommandBody {
  choice?: OptionKey;
  note?: string;
  followup?: OptionKey;
  value?: string;
  text?: string;
}
/**
 * Hub -> system. Delivered to the connector, applied via the scheduler (answer) or typed to the orchestrator (reply, prompt).
 */
export interface Command {
  id: string;
  type: CommandType;
  run_id: string | null;
  decision_id: string | null;
  body: CommandBody;
  by: Username;
  created_at: Timestamp;
  expires_at: NullableTimestamp;
}
export interface PingResponse {
  protocol: number;
  min_protocol: number;
  server_time: Timestamp;
  version: string;
}
export interface HelloRequest {
  protocol: 2;
  workspace_id: WorkspaceId;
  session_id: string;
  name: string;
  path: string;
  kit_version: string | null;
  connector_version: string;
  upload: UploadSettings;
}
export interface UploadSettings {
  documents: boolean;
  diffs: boolean;
  orchestrator_screen: boolean;
}
/**
 * What the backend already has, so the connector sends only differences. All empty when known=false (new or wiped DB).
 */
export interface HelloResponse {
  known: boolean;
  server_time: Timestamp;
  /**
   * run_id -> last stored event n
   */
  event_cursors: {
    [k: string]: number | undefined;
  };
  /**
   * '<run_id>/<decision_id>' -> sha256 of the canonical Decision JSON
   */
  decision_hashes: {
    [k: string]: Sha256 | undefined;
  };
  /**
   * path -> sha256 of content
   */
  document_hashes: {
    [k: string]: Sha256 | undefined;
  };
  snapshot_hash: string | null;
}
export interface GoodbyeRequest {
  session_id: string;
  reason: "orchestrator_gone" | "signal" | "manual";
}
export interface DecisionsBatch {
  /**
   * @maxItems 200
   */
  decisions: Decision[];
}
export interface EventsBatch {
  run_id: RunId;
  /**
   * @maxItems 200
   */
  events: Event[];
}
export interface EventsResponse {
  run_id: RunId;
  cursor: number;
}
/**
 * Max 5 MB serialized per request; split bigger uploads.
 */
export interface DocumentsBatch {
  /**
   * @maxItems 50
   */
  documents: Document[];
}
export interface CommandsResponse {
  /**
   * @maxItems 50
   */
  commands: Command[];
}
export interface AckRequest {
  status: AckStatus;
  reason: string | null;
}
export interface WorkspaceSummary {
  id: WorkspaceId;
  name: string;
  path: string | null;
  status: WorkspaceStatus;
  last_seen_at: NullableTimestamp;
  kit_version: string | null;
  kit_outdated: boolean;
  open_decisions: number;
  problems: number;
  orchestrator_state: "idle" | "working" | "blocked" | "done" | "unknown" | "absent" | null;
  active_run: {
    run_id: RunId;
    status: RunStatus;
    title: string | null;
  } | null;
  archived: boolean;
  upload: UploadSettings | null;
  orchestrator_last_activity_at: NullableTimestamp;
  computer_id: string | null;
  computer_online: boolean;
}
/**
 * A decision as the UI sees it: the scheduler's view plus the hub's delivery state. pending_command = the latest answer/reply command for it, if any.
 */
export interface HubDecision {
  workspace_id: WorkspaceId;
  hub_status: HubDecisionStatus;
  status_reason: string | null;
  updated_at: Timestamp;
  pending_command: UserCommand | null;
  decision: Decision;
}
export interface UserCommand {
  id: string;
  workspace_id: WorkspaceId;
  type: CommandType;
  run_id: string | null;
  decision_id: string | null;
  body: CommandBody;
  status: CommandStatus;
  status_reason: string | null;
  by: string | null;
  created_at: Timestamp;
  delivered_at: NullableTimestamp;
  expires_at: NullableTimestamp;
}
export interface WorkspaceDetail {
  workspace: WorkspaceSummary;
  snapshot: Snapshot | null;
  decisions_open: HubDecision[];
  /**
   * @maxItems 50
   */
  commands_recent: UserCommand[];
}
export interface AnswerRequest {
  choice: OptionKey;
  note?: string;
  followup?: OptionKey;
  value?: string;
}
/**
 * Body of reply (to a decision) and prompt (to the orchestrator).
 */
export interface TextRequest {
  text: string;
}
export interface DocumentMeta {
  path: string;
  run_id: string | null;
  kind: DocumentKind;
  title: string;
  format: DocumentFormat;
  bytes: number;
  truncated: boolean;
  updated_at: Timestamp;
  deleted: boolean;
}
export interface DocumentContent {
  meta: DocumentMeta;
  content: string;
}
/**
 * type=answer: my answer (hub or chat). reply/prompt: text I sent from the hub. routine: Opus's own call (DECIDED_BY_OPUS).
 */
export interface HistoryItem {
  id: string;
  at: Timestamp;
  type: "answer" | "reply" | "prompt" | "routine";
  run_id: string | null;
  decision_id: string | null;
  title: string | null;
  choice: string | null;
  label: string | null;
  text: string | null;
  quote: string | null;
  channel: "chat" | "hub" | "opus" | null;
  by: string | null;
  status: string | null;
}
export interface LoginRequest {
  username: Username;
  password: string;
  remember: boolean;
}
export interface LoginResponse {
  token: string;
  expires_at: Timestamp;
  username: Username;
}
export interface PasswordChangeRequest {
  current: string;
  new: string;
}
export interface Me {
  username: Username;
  computers: ComputerSummary[];
}
export interface ComputerSummary {
  id: ComputerId;
  name: string;
  online: boolean;
  last_seen_at: NullableTimestamp;
}
export interface AdminUserRequest {
  username: Username;
}
export interface AdminUserResponse {
  username: Username;
  password: string;
}
export interface ComputerRegisterRequest {
  username: Username;
  password: string;
  name: string;
}
export interface ComputerRegisterResponse {
  computer_id: ComputerId;
  computer_key: string;
  proxy_public_key: string;
  username: Username;
}
export interface WorkspaceIndexEntry {
  workspace_id: WorkspaceId;
  name: string;
  status: WorkspaceStatus;
  last_seen_at: NullableTimestamp;
}
export interface RelayRequest {
  type: "req";
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query: string;
  body: {} | unknown[] | string | number | boolean | null;
  assertion: string;
  stream: boolean;
}
export interface RelayResponse {
  type: "res";
  id: string;
  status: number;
  body: {} | unknown[] | string | number | boolean | null;
}
export interface RelayStreamChunk {
  type: "chunk";
  id: string;
  data: string;
}
export interface RelayStreamEnd {
  type: "end";
  id: string;
  status: number;
}
export interface RelayCancel {
  type: "cancel";
  id: string;
}
export interface RelayHello {
  type: "hello";
  protocol: 2;
  computer_id: ComputerId;
  backend_version: string;
  /**
   * @maxItems 200
   */
  workspaces: WorkspaceIndexEntry[];
}
export interface RelayWorkspaces {
  type: "workspaces";
  /**
   * @maxItems 200
   */
  workspaces: WorkspaceIndexEntry[];
}
export interface RelayPing {
  type: "ping";
}
export interface RelayPong {
  type: "pong";
}
export interface RelayPollResponse {
  /**
   * @maxItems 50
   */
  frames: {}[];
}
export interface RelayFramesRequest {
  /**
   * @maxItems 50
   */
  frames: {}[];
}
export interface Assertion {
  v: 1;
  sub: Username;
  cid: ComputerId;
  rid: string;
  exp: number;
}
/**
 * Generic list envelope: items + next cursor (null = no more). Item type is per route.
 */
export interface List {
  items: unknown[];
  next: string | null;
}
/**
 * One Server-Sent Event payload (event name = type). The UI refetches the named resource.
 */
export interface StreamEvent {
  type: "workspace" | "snapshot" | "decision" | "command" | "document" | "history";
  workspace_id: WorkspaceId;
  at: Timestamp;
  /**
   * decision '<run>/<D>', command id, or document path
   */
  ref: string | null;
}
