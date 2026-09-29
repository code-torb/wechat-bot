import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { createConversationStore } from '../../src/management/conversations/repository.js'
import { runRetention } from '../../src/management/operations/retention.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'history-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  return { db, conversations: createConversationStore(db) }
}

test('retention removes old terminal runs and keeps pending work', (t) => {
  const { db, conversations } = fixture(t)
  const oldNow = Date.now() - 31 * 24 * 3600 * 1000
  const old = conversations.accept({
    message: { botAccountId: 'bot-a', scene: 'group', peerId: '1', senderId: '2', messageId: 'old', text: 'old' },
    agentId: 'agent-a',
  })
  db.prepare('UPDATE runs SET status = ?, created_at = ?, updated_at = ? WHERE id = ?').run('sent', oldNow, oldNow, old.runId)
  db.prepare('UPDATE messages SET created_at = ? WHERE conversation_id = ?').run(oldNow, old.conversationId)
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(oldNow, old.conversationId)
  const pending = conversations.accept({
    message: { botAccountId: 'bot-a', scene: 'group', peerId: '3', senderId: '4', messageId: 'pending', text: 'pending' },
    agentId: 'agent-a',
  })
  db.prepare('UPDATE runs SET status = ?, created_at = ?, updated_at = ? WHERE id = ?').run('waiting_send', Date.now(), Date.now(), pending.runId)
  const auditOld = Date.now() - 91 * 24 * 3600 * 1000
  db.prepare('INSERT INTO audit_events (id, actor_type, actor_id, action, resource_type, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'audit-old',
    'admin',
    'owner-1',
    'test',
    'agents',
    'ok',
    auditOld,
  )
  runRetention({ db, now: Date.now() })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runs WHERE id = ?').get(old.runId).count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM runs WHERE id = ?').get(pending.runId).count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE id = ?').get('audit-old').count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE id = ?').get(old.conversationId).count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE id = ?').get(pending.conversationId).count, 1)
})

test('conversation list supports identity filters and cursor pagination', (t) => {
  const { conversations } = fixture(t)
  for (let i = 0; i < 3; i += 1) {
    conversations.accept({
      message: { botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: `${i}`, messageId: `${i}`, text: 'hi' },
      agentId: 'agent-a',
    })
  }
  const first = conversations.list({ limit: 2 })
  assert.equal(first.rows.length, 2)
  assert.equal(first.next.length > 0, true)
  const filtered = conversations.list({ senderId: '1' })
  assert.equal(filtered.rows.length, 1)
})
