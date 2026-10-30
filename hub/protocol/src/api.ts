// Agent Hub API v2: routes, headers, error codes and limits shared by the backend, proxy and web UI.
// The request/response bodies are the $defs named in each route (see docs/hub-api.md).

export const PROTOCOL = 2;
export const MIN_PROTOCOL = 2;
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
  passwordMinChars: 12,
  sessionHours: 12,
  sessionRememberDays: 30,
  loginAttemptsPerMinute: 5,
  pbkdf2Iterations: 20_000,
  relayFrameBytes: 900 * 1024,
  relayTimeoutSeconds: 30,
  relayPollSeconds: 25,
  recentWorkspaceDays: 15,
  runRetentionDays: 60,
} as const;

/** Error codes in ApiError.error.code, with their HTTP status. */
export const ERRORS = {
  bad_request: 400,            // body fails the schema (message names the first error)
  internal_error: 500,
  unauthorized: 401,           // missing/invalid/revoked token
  invalid_credentials: 401,
  forbidden: 403,              // token of the wrong kind for this route
  not_found: 404,
  duplicate_workspace: 409,    // hello: another live session already holds this workspace_id
  username_taken: 409,
  workspace_not_online: 409,   // prompt/reply to a workspace that is not ONLINE
  decision_not_answerable: 409,// answer/reply to a decision that is not OPEN or REJECTED
  invalid_option: 422,         // choice/followup not among the decision's options, or followup value missing
  weak_password: 422,
  payload_too_large: 413,
  computer_offline: 503,
  computer_timeout: 504,
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

/** Browser-to-proxy routes. Workspace routes are relayed unchanged. */
export const USER_ROUTES = {
  login:       { method: "POST",   path: "/auth/login",                  body: "LoginRequest", res: "LoginResponse" },
  logout:      { method: "POST",   path: "/auth/logout",                                         res: "204" },
  password:    { method: "POST",   path: "/auth/password",               body: "PasswordChangeRequest", res: "204" },
  me:          { method: "GET",    path: "/me",                                                   res: "Me" },
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
  computerStream: { method: "GET", path: "/computers/:c/stream",                              res: "text/event-stream of StreamEvent" },
} as const satisfies Record<string, Route>;

/** Admin CLI routes: `Authorization: Bearer <admin key>`. */
export const ADMIN_ROUTES = {
  createUser:    { method: "POST", path: "/admin/users", body: "AdminUserRequest", res: "AdminUserResponse" },
  resetPassword: { method: "POST", path: "/admin/users/:username/reset-password", res: "AdminUserResponse" },
  zaloSetup:     { method: "POST", path: "/admin/zalo/setup", res: "{ok:boolean, outcome:string|null, hint:string|null}" },
} as const satisfies Record<string, Route>;

/** Computer routes: registration is unauthenticated; connect uses a computer key. */
export const COMPUTER_ROUTES = {
  register: { method: "POST", path: "/computers/register", body: "ComputerRegisterRequest", res: "ComputerRegisterResponse" },
  connect:  { method: "GET", path: "/computers/:c/connect", res: "WebSocket" },
  poll:     { method: "GET", path: "/computers/:c/poll?wait=:seconds", res: "RelayPollResponse" },
  frames:   { method: "POST", path: "/computers/:c/frames", body: "RelayFramesRequest", res: "204" },
  notify:   { method: "POST", path: "/computers/:c/notify", body: "NotifyRequest", res: "204" },
} as const satisfies Record<string, Route>;

/** Notification routes on the proxy: session auth, except the Zalo webhook (X-Bot-Api-Secret-Token). */
export const NOTIFY_ROUTES = {
  status:   { method: "GET",    path: "/notifications",                 res: "NotificationStatus" },
  linkCode: { method: "POST",   path: "/notifications/zalo/code",       res: "ZaloLinkCode" },
  test:     { method: "POST",   path: "/notifications/test",            res: "204" },
  unlink:   { method: "DELETE", path: "/notifications/targets/:target", res: "204" },
  webhook:  { method: "POST",   path: "/zalo/webhook",                  body: "Zalo Bot update", res: "200" },
} as const satisfies Record<string, Route>;
