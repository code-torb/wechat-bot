ALTER TABLE agents ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json));

CREATE TABLE IF NOT EXISTS agent_relations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  relation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(relation_json)),
  context_doc TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, person_name)
);

CREATE TABLE IF NOT EXISTS agent_knowledge_docs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
