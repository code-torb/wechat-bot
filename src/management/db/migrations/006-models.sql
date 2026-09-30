CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  aad_kind TEXT NOT NULL DEFAULT 'model',
  api_key_cipher TEXT NOT NULL,
  api_key_nonce TEXT NOT NULL,
  api_key_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  search_key_cipher TEXT,
  search_key_nonce TEXT,
  search_key_tag TEXT,
  search_key_version INTEGER,
  embedding_model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
