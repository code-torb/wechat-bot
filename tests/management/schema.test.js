import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { migrate } from '../../src/management/db/migrate.js'

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-mgmt-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { filename: join(dir, 'test.sqlite'), dir }
}

test('migration applies once, is idempotent, and enables foreign keys', (t) => {
  const { filename } = tempDb(t)
  const db = openDatabase({ filename })
  assert.equal(migrate(db), 6)
  assert.equal(migrate(db), 6)
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  db.close()
})

test('schema data survives close and reopen', (t) => {
  const { filename } = tempDb(t)
  let db = openDatabase({ filename })
  db.prepare('INSERT INTO settings (key, value_json, revision, updated_at) VALUES (?, ?, 1, ?)').run('test', '{"a":1}', Date.now())
  db.close()
  db = openDatabase({ filename })
  assert.equal(db.prepare("SELECT value_json FROM settings WHERE key = 'test'").get().value_json, '{"a":1}')
  db.close()
})

test('agent version uniqueness, binding uniqueness and style value range are enforced', (t) => {
  const { filename } = tempDb(t)
  const db = openDatabase({ filename })
  const now = Date.now()
  db.prepare('INSERT INTO agents (id, name, status, draft_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    'agent-a',
    'A',
    'active',
    '{}',
    now,
    now,
  )
  db.prepare('INSERT INTO agent_versions (id, agent_id, version, snapshot_json, created_at) VALUES (?, ?, 1, ?, ?)').run(
    'version-a1',
    'agent-a',
    '{}',
    now,
  )
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO agent_versions (id, agent_id, version, snapshot_json, created_at) VALUES (?, ?, 1, ?, ?)')
        .run('version-a2', 'agent-a', '{}', now),
    /UNIQUE/i,
  )
  db.prepare('INSERT INTO bot_accounts (id, platform, self_id, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    'bot-a',
    'qq-onebot',
    '12345',
    now,
    now,
  )
  db.prepare('INSERT INTO agent_bindings (id, bot_account_id, scope_type, scope_key, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'binding-1',
    'bot-a',
    'group',
    '34567',
    'agent-a',
    now,
  )
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO agent_bindings (id, bot_account_id, scope_type, scope_key, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('binding-2', 'bot-a', 'group', '34567', 'agent-a', now),
    /UNIQUE/i,
  )
  const styleId = 'style-a'
  const styleVersionId = 'style-a1'
  db.prepare(
    'INSERT INTO style_definitions (id, key, enabled, revision, activation_generation, created_at, updated_at) VALUES (?, ?, 1, 1, 1, ?, ?)',
  ).run(styleId, 'curiosity', now, now)
  db.prepare(
    'INSERT INTO style_definition_versions (id, definition_id, version, name, default_value, low_text, mid_text, high_text, created_at) VALUES (?, ?, 1, ?, 0.5, ?, ?, ?, ?)',
  ).run(styleVersionId, styleId, 'curiosity', 'low', 'mid', 'high', now)
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO agent_style_values (agent_id, definition_id, definition_version_id, value, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('agent-a', styleId, styleVersionId, 1.1, now),
    /CHECK/i,
  )
  db.close()
})

test('foreign key violation is rejected on runtime tables', (t) => {
  const { filename } = tempDb(t)
  const db = openDatabase({ filename })
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO runs (id, event_key, conversation_id, epoch, status, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
        .run('run-1', 'event-1', 'missing-conversation', 'queued', Date.now(), Date.now()),
    /FOREIGN KEY/i,
  )
  db.close()
})
