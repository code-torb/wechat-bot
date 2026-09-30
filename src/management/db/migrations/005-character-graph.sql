CREATE TABLE IF NOT EXISTS character_nodes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json)),
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, name)
);

CREATE TABLE IF NOT EXISTS character_edges (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES character_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES character_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  boundary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_character_edges_agent ON character_edges(agent_id);
