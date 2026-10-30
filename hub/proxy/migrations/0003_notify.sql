CREATE TABLE IF NOT EXISTS notify_link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notify_link_codes_user_id_idx ON notify_link_codes(user_id);

CREATE TABLE IF NOT EXISTS notify_targets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel = 'zalo'),
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('private', 'group')),
  display_name TEXT,
  linked_at TEXT NOT NULL,
  broken INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, chat_id)
);
CREATE INDEX IF NOT EXISTS notify_targets_user_id_idx ON notify_targets(user_id);

CREATE TABLE IF NOT EXISTS notify_usage (
  month TEXT PRIMARY KEY,
  sent INTEGER NOT NULL
);
