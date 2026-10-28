// Agent Hub API v1: routes, headers, error codes and limits shared by the backend and the web UI.
// The request/response bodies are the $defs named in each route (see docs/hub-api.md).

export const PROTOCOL = 1;
export const MIN_PROTOCOL = 1;
export const PROTOCOL_HEADER = "X-Agent-Hub-Protocol";
export const DEFAULT_PORT = 7420;
export const API_PREFIX = "/api/v1";

export const LIMITS = {
  snapshotBytes: 256 * 1024,
  documentBytes: 1024 * 1024,
  documentsRequestBytes: 5 * 1024 * 1024,
  textChars: 8192,
  eventsPerRequest: 200,
  decisionsPerRequest: 200,
  commandsPerPoll: 50,
  longPollSeconds: 25,
  heartbeatSeconds: 30,
  offlineAfterSeconds: 90,
  promptExpirySeconds: 30 * 60,
  pairCodeSeconds: 10 * 60,
} as const;

/** Error codes in ApiError.error.code, with their HTTP status. */
export const ERRORS = {
  bad_request: 400,            // body fails the schema (message names the first error)
  unauthorized: 401,           // missing/invalid/revoked token
  forbidden: 403,              // token of the wrong kind for this route
  not_found: 404,
  duplicate_workspace: 409,    // hello: another live session already holds this workspace_id
  workspace_not_online: 409,   // prompt/reply to a workspace that is not ONLINE
  decision_not_answerable: 409,// answer/reply to a decision that is not OPEN or REJECTED
  invalid_option: 422,         // choice/followup not among the decision's options, or followup value missing
  payload_too_large: 413,
  protocol_unsupported: 426,   // X-Agent-Hub-Protocol below MIN_PROTOCOL
  rate_limited: 429,
} as const;
export type ErrorCode = keyof typeof ERRORS;

type Route = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: string; res: string };

/** Connector routes: `Authorization: Bearer <connector key>`. */
export const CONNECTOR_ROUTES = {
  ping:      { method: "GET",    path: "/agent/ping",                                      res: "PingResponse" },
  hello:     { method: "POST",   path: "/agent/hello",               body: "HelloRequest",   res: "HelloResponse" },
  goodbye:   { method: "POST",   path: "/agent/workspaces/:ws/goodbye", body: "GoodbyeRequest", res: "204" },
  snapshot:  { method: "PUT",    path: "/agent/workspaces/:ws/snapshot", body: "Snapshot",    res: "204" },
  heartbeat: { method: "POST",   path: "/agent/workspaces/:ws/heartbeat",                  res: "204" },
  decisions: { method: "PUT",    path: "/agent/workspaces/:ws/decisions", body: "DecisionsBatch", res: "204" },
  events:    { method: "POST",   path: "/agent/workspaces/:ws/events", body: "EventsBatch",   res: "EventsResponse" },
  documents: { method: "PUT",    path: "/agent/workspaces/:ws/documents", body: "DocumentsBatch", res: "204" },
  docDelete: { method: "DELETE", path: "/agent/workspaces/:ws/documents?path=:path",       res: "204" },
  commands:  { method: "GET",    path: "/agent/workspaces/:ws/commands?wait=:seconds",     res: "CommandsResponse" },
  ack:       { method: "POST",   path: "/agent/workspaces/:ws/commands/:id/ack", body: "AckRequest", res: "204" },
} as const satisfies Record<string, Route>;

/** User routes: `Authorization: Bearer <device token>` (except pair). */
export const USER_ROUTES = {
  pair:        { method: "POST",   path: "/pair",                         body: "PairRequest", res: "PairResponse" },
  devices:     { method: "GET",    path: "/devices",                                          res: "List<Device>" },
  revoke:      { method: "DELETE", path: "/devices/:id",                                      res: "204" },
  workspaces:  { method: "GET",    path: "/workspaces?archived=:bool",                         res: "List<WorkspaceSummary>" },
  workspace:   { method: "GET",    path: "/workspaces/:ws",                                   res: "WorkspaceDetail" },
  archive:     { method: "PATCH",  path: "/workspaces/:ws",               body: "{archived:boolean}", res: "WorkspaceSummary" },
  decisions:   { method: "GET",    path: "/workspaces/:ws/decisions?status=:hub_status&run=:run&cursor=:c", res: "List<HubDecision>" },
  decision:    { method: "GET",    path: "/workspaces/:ws/decisions/:run/:id",                res: "HubDecision" },
  answer:      { method: "POST",   path: "/workspaces/:ws/decisions/:run/:id/answer", body: "AnswerRequest", res: "UserCommand" },
  reply:       { method: "POST",   path: "/workspaces/:ws/decisions/:run/:id/reply", body: "TextRequest",    res: "UserCommand" },
  prompt:      { method: "POST",   path: "/workspaces/:ws/prompts",       body: "TextRequest", res: "UserCommand" },
  commands:    { method: "GET",    path: "/workspaces/:ws/commands?cursor=:c",                res: "List<UserCommand>" },
  documents:   { method: "GET",    path: "/workspaces/:ws/documents?run=:run",                res: "List<DocumentMeta>" },
  document:    { method: "GET",    path: "/workspaces/:ws/documents/content?path=:path",      res: "DocumentContent" },
  history:     { method: "GET",    path: "/workspaces/:ws/history?type=:type&run=:run&cursor=:c", res: "List<HistoryItem>" },
  stream:      { method: "GET",    path: "/stream?token=:token",                              res: "text/event-stream of StreamEvent" },
} as const satisfies Record<string, Route>;
