CREATE TABLE conversations_new (
  id TEXT PRIMARY KEY,
  bot_account_id TEXT NOT NULL,
  scene TEXT NOT NULL CHECK (scene IN ('group', 'private')),
  peer_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  current_epoch INTEGER NOT NULL DEFAULT 1,
  last_agent_version_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO conversations_new (id, bot_account_id, scene, peer_id, sender_id, agent_id, current_epoch, last_agent_version_id, active, created_at, updated_at)
  SELECT id, bot_account_id, scene, peer_id, sender_id, agent_id, current_epoch, last_agent_version_id, 1, created_at, updated_at FROM conversations;

DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;

CREATE UNIQUE INDEX idx_conversations_active_key
  ON conversations(bot_account_id, scene, peer_id, sender_id, agent_id) WHERE active = 1;
