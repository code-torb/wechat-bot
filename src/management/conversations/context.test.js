import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createConversationStore } from './repository.js'

const message = (overrides = {}) => ({
  botAccountId: 'bot-a',
  scene: 'group',
  peerId: '34567',
  senderId: '23456',
  messageId: '1',
  text: '你好',
  ...overrides,
})

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'conversation-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  return { db, conversations: createConversationStore(db), filename: join(dir, 't.sqlite') }
}

test('same event key produces exactly one run and no duplicate conversation', (t) => {
  const { conversations } = fixture(t)
  const first = conversations.accept({ message: message(), agentId: 'agent-a', agentVersionId: 'v1' })
  const second = conversations.accept({ message: message(), agentId: 'agent-a', agentVersionId: 'v1' })
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
})

test('conversations are isolated across group, private, user and agent', (t) => {
  const { conversations } = fixture(t)
  const ids = []
  for (const [scene, peerId, senderId, agentId] of [
    ['group', '34567', '23456', 'agent-a'],
    ['group', '34567', '45678', 'agent-a'],
    ['private', '23456', '23456', 'agent-a'],
    ['group', '34567', '23456', 'agent-b'],
  ]) {
    const result = conversations.accept({
      message: message({ scene, peerId, senderId, messageId: `${scene}-${peerId}-${senderId}-${agentId}` }),
      agentId,
    })
    ids.push(result.conversationId)
  }
  assert.equal(new Set(ids).size, 4)
})

test('data survives restart and context only includes delivered turns', (t) => {
  const { db, conversations, filename } = fixture(t)
  const { conversationId, runId, epoch } = conversations.accept({ message: message(), agentId: 'agent-a', agentVersionId: 'v1' })
  db.prepare(
    'INSERT INTO messages (id, conversation_id, epoch, run_id, role, content_json, visibility, delivery_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('m1', conversationId, epoch, runId, 'assistant', JSON.stringify({ text: '回复一' }), 'visible', 'sent', Date.now() + 1)
  const userRun = conversations.accept({ message: message({ messageId: '2', text: '追问' }), agentId: 'agent-a', agentVersionId: 'v1' })
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('unknown', userRun.runId)
  db.close()
  const reopened = openDatabase({ filename })
  const store = createConversationStore(reopened)
  const context = store.getContext({ conversationId, epoch, maxTurns: 10 })
  assert.deepEqual(
    context.map((item) => item.content),
    ['你好', '回复一'],
  )
  reopened.close()
})

test('reset keeps history but starts a new context epoch', (t) => {
  const { conversations } = fixture(t)
  const { conversationId, epoch } = conversations.accept({ message: message(), agentId: 'agent-a', agentVersionId: 'v1' })
  const reset = conversations.reset({ conversationId, actor: 'owner-1' })
  assert.equal(reset.epoch, epoch + 1)
  assert.equal(conversations.messages(conversationId).rows.length, 1)
  assert.deepEqual(conversations.getContext({ conversationId, epoch: reset.epoch, maxTurns: 10 }), [])
})

test('delete messages removes history and bumps epoch', (t) => {
  const { conversations } = fixture(t)
  const { conversationId } = conversations.accept({ message: message(), agentId: 'agent-a', agentVersionId: 'v1' })
  conversations.deleteMessages(conversationId)
  assert.equal(conversations.messages(conversationId).rows.length, 0)
  assert.equal(conversations.get(conversationId).current_epoch, 2)
})
