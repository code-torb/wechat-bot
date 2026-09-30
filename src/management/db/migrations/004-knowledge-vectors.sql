ALTER TABLE providers ADD COLUMN embedding_model TEXT NOT NULL DEFAULT '';

CREATE TABLE credentials_new (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('model', 'search', 'embedding')),
  cipher TEXT NOT NULL,
  nonce TEXT NOT NULL,
  tag TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO credentials_new (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at)
  SELECT id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at FROM credentials;

DROP TABLE credentials;
ALTER TABLE credentials_new RENAME TO credentials;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES agent_knowledge_docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_agent ON knowledge_chunks(agent_id, created_at);
