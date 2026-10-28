CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS connector_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pair_codes (
  code_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  kit_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'STOPPED')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT,
  finished_at TEXT,
  finish_result TEXT,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id)
);

CREATE TABLE IF NOT EXISTS events (
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, n)
);

CREATE TABLE IF NOT EXISTS decisions (
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  agent TEXT,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  followup TEXT,
  recommend TEXT,
  local_status TEXT NOT NULL,
  answer TEXT,
  consumed_by TEXT,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, decision_id)
);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL CHECK (type IN ('answer', 'reply', 'prompt')),
  run_id TEXT,
  decision_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'HELD', 'DELIVERED', 'REJECTED', 'FAILED', 'EXPIRED')),
  status_reason TEXT,
  device_id TEXT REFERENCES devices(id),
  device_name TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  last_ack_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  truncated INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, path)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS decisions_workspace_status ON decisions(workspace_id, local_status);
CREATE INDEX IF NOT EXISTS commands_workspace_status ON commands(workspace_id, status);
CREATE INDEX IF NOT EXISTS events_workspace_at ON events(workspace_id, at DESC);
CREATE INDEX IF NOT EXISTS sessions_workspace_live ON workspace_sessions(workspace_id, ended_at);
