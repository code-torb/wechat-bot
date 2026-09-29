CREATE TABLE IF NOT EXISTS inbound_events (
  event_key TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  bot_account_id TEXT NOT NULL,
  scene TEXT NOT NULL CHECK (scene IN ('group', 'private')),
  peer_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  current_epoch INTEGER NOT NULL DEFAULT 1,
  last_agent_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (bot_account_id, scene, peer_id, sender_id, agent_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  agent_version_id TEXT,
  effective_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(effective_config_json)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'waiting_send', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
  model_ms INTEGER,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system_tool')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
  delivery_status TEXT NOT NULL DEFAULT 'recorded' CHECK (delivery_status IN ('recorded', 'sent', 'failed', 'unknown', 'cancelled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reply_plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  reply_json TEXT NOT NULL CHECK (json_valid(reply_json)),
  pacing_json TEXT NOT NULL CHECK (json_valid(pacing_json)),
  due_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
  cancellation_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  reply_plan_id TEXT NOT NULL REFERENCES reply_plans(id) ON DELETE CASCADE,
  part_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'unknown')),
  platform_message_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'denied', 'failed', 'pending_approval')),
  sanitized_result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (run_id, call_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tool_run_id TEXT NOT NULL UNIQUE REFERENCES tool_runs(id) ON DELETE CASCADE,
  expected_file_hash TEXT,
  content_hash TEXT,
  proposal_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'qq_user', 'system')),
  actor_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  trace_id TEXT,
  before_revision INTEGER,
  after_revision INTEGER,
  result TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_identity ON conversations(bot_account_id, scene, peer_id, sender_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, epoch, created_at, id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_reply_plans_due ON reply_plans(state, due_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at, id);
