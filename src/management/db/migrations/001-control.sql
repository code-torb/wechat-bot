CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  auth_revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_scopes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  UNIQUE (user_id, resource_type, resource_id, operation)
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capability_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('model', 'search')),
  cipher TEXT NOT NULL,
  nonce TEXT NOT NULL,
  tag TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
  draft_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(draft_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  published_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  actor_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, version)
);

CREATE TABLE IF NOT EXISTS style_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  owner_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  activation_generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (key, owner_agent_id)
);

CREATE TABLE IF NOT EXISTS style_definition_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES style_definitions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_value REAL NOT NULL CHECK (default_value >= 0 AND default_value <= 1),
  low_text TEXT NOT NULL,
  mid_text TEXT NOT NULL,
  high_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (definition_id, version)
);

CREATE TABLE IF NOT EXISTS agent_style_values (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES style_definitions(id) ON DELETE CASCADE,
  definition_version_id TEXT NOT NULL REFERENCES style_definition_versions(id) ON DELETE RESTRICT,
  value REAL NOT NULL CHECK (value >= 0 AND value <= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, definition_id)
);

CREATE TABLE IF NOT EXISTS bot_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  self_id TEXT NOT NULL,
  default_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (platform, self_id)
);

CREATE TABLE IF NOT EXISTS qq_access_rules (
  id TEXT PRIMARY KEY,
  bot_account_id TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'private', 'group_user')),
  scope_key TEXT NOT NULL,
  allow INTEGER NOT NULL DEFAULT 0 CHECK (allow IN (0, 1)),
  trigger_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trigger_json)),
  max_level INTEGER NOT NULL DEFAULT 0 CHECK (max_level BETWEEN 0 AND 3),
  pacing_override_json TEXT CHECK (pacing_override_json IS NULL OR json_valid(pacing_override_json)),
  quote_reply INTEGER NOT NULL DEFAULT 0 CHECK (quote_reply IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (bot_account_id, scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS agent_bindings (
  id TEXT PRIMARY KEY,
  bot_account_id TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'private', 'group_user')),
  scope_key TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE (bot_account_id, scope_type, scope_key)
);

CREATE TABLE IF NOT EXISTS principal_grants (
  id TEXT PRIMARY KEY,
  bot_account_id TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
  scene TEXT NOT NULL CHECK (scene IN ('group', 'private')),
  peer_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (bot_account_id, scene, peer_id, sender_id, capability, resource_id)
);

CREATE TABLE IF NOT EXISTS command_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS command_versions (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES command_definitions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
  input_schema_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_schema_json)),
  execution_type TEXT NOT NULL CHECK (execution_type IN ('builtin', 'static', 'model_task', 'workflow')),
  steps_json TEXT CHECK (steps_json IS NULL OR json_valid(steps_json)),
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json)),
  created_at INTEGER NOT NULL,
  UNIQUE (command_id, version)
);

CREATE TABLE IF NOT EXISTS file_resources (
  id TEXT PRIMARY KEY,
  mount_alias TEXT NOT NULL UNIQUE,
  operations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(operations_json)),
  allowed_extensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_extensions_json)),
  max_bytes INTEGER NOT NULL,
  daily_write_limit INTEGER NOT NULL DEFAULT 0,
  auto_approve INTEGER NOT NULL DEFAULT 0 CHECK (auto_approve IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_grants (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES file_resources(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT,
  output_scope TEXT NOT NULL DEFAULT 'private' CHECK (output_scope IN ('private', 'group')),
  created_at INTEGER NOT NULL,
  UNIQUE (resource_id, agent_id, user_id)
);

CREATE TABLE IF NOT EXISTS meme_assets (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
