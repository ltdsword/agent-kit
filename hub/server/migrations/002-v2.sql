ALTER TABLE workspaces ADD COLUMN upload TEXT;
ALTER TABLE workspaces ADD COLUMN orchestrator_last_activity_at TEXT;

ALTER TABLE runs ADD COLUMN title TEXT;
ALTER TABLE runs ADD COLUMN goal TEXT;

CREATE TABLE commands_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL CHECK (type IN ('answer', 'reply', 'prompt')),
  run_id TEXT,
  decision_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'HELD', 'DELIVERED', 'REJECTED', 'FAILED', 'EXPIRED')),
  status_reason TEXT,
  by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  last_ack_at TEXT,
  expires_at TEXT
);

INSERT INTO commands_v2 (id,workspace_id,type,run_id,decision_id,body,status,status_reason,by,created_at,delivered_at,last_ack_at,expires_at)
SELECT id,workspace_id,type,run_id,decision_id,body,status,status_reason,'unknown',created_at,delivered_at,last_ack_at,expires_at
FROM commands;

DROP TABLE commands;
ALTER TABLE commands_v2 RENAME TO commands;
CREATE INDEX commands_workspace_status ON commands(workspace_id, status);

DROP TABLE pair_codes;
DROP TABLE devices;
