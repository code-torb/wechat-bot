import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createConversationStore } from '../conversations/repository.js'
import { createReplyPlanStore } from './reply-plans.js'
import { createReplyScheduler } from './scheduler.js'
import { renderReply } from '../../platforms/onebot/render.js'
import { createPolicyEngine } from '../permissions/policy.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const conversations = createConversationStore(db)
  const plans = createReplyPlanStore(db)
  const calls = []
  const client = {
    identity: { selfId: '12345', generation: 1 },
    call: async (action, params) => {
      calls.push({ action, params })
    },
  }
  return { db, conversations, plans, client, calls }
}

test('scheduler waits until due, rechecks generation and records delivery', async (t) => {
  const { db, conversations, plans, client, calls } = fixture(t)
  const accepted = conversations.accept({
    message: { botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', messageId: '1', text: '你好' },
    agentId: 'agent-a',
    agentVersionId: 'v1',
  })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine: createPolicyEngine({ db }),
    router: { resolve: () => ({ accepted: true, maxLevel: 0 }) },
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const id = scheduler.schedule({
    runId: accepted.runId,
    generation: 1,
    epoch: accepted.epoch,
    reply: { text: '稍后回复', assetIds: [], sourceLinks: [], requiredCapabilities: ['chat'] },
    pacing: { baseDelayMs: 80, charsPerSecond: 0, maxDelayMs: 100 },
  })
  assert.equal(plans.get(id).state, 'pending')
  const deadline = Date.now() + 2000
  while (plans.get(id).state === 'pending' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(plans.get(id).state, 'sent')
  assert.equal(calls[0].action, 'send_group_msg')
  assert.equal(calls[0].params.message[0].data.text, '稍后回复')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE delivery_status = 'sent'").get().count, 2)
  const context = conversations.getContext({ conversationId: accepted.conversationId, epoch: accepted.epoch, maxTurns: 10 })
  assert.deepEqual(
    context.map((item) => item.content),
    ['你好', '稍后回复'],
  )
})

test('reset cancels a pending plan and restart cancels all pending', async (t) => {
  const { db, conversations, plans, client, calls } = fixture(t)
  const accepted = conversations.accept({
    message: { botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', messageId: '1', text: '你好' },
    agentId: 'agent-a',
    agentVersionId: 'v1',
  })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine: createPolicyEngine({ db }),
    router: { resolve: () => ({ accepted: true, maxLevel: 0 }) },
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const id = scheduler.schedule({
    runId: accepted.runId,
    generation: 1,
    epoch: accepted.epoch,
    reply: { text: '慢回复', assetIds: [], sourceLinks: [], requiredCapabilities: ['chat'] },
    pacing: { baseDelayMs: 500, charsPerSecond: 0, maxDelayMs: 600 },
  })
  scheduler.cancelForConversation({ conversationId: accepted.conversationId, epoch: accepted.epoch, reason: 'reset' })
  assert.equal(plans.get(id).state, 'cancelled')
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(calls.length, 0)
  const second = conversations.accept({
    message: { botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', messageId: '2', text: '第二条' },
    agentId: 'agent-a',
    agentVersionId: 'v1',
  })
  const id2 = scheduler.schedule({
    runId: second.runId,
    generation: 1,
    epoch: accepted.epoch,
    reply: { text: '重启前', assetIds: [], sourceLinks: [], requiredCapabilities: ['chat'] },
    pacing: { baseDelayMs: 200, charsPerSecond: 0, maxDelayMs: 300 },
  })
  scheduler.stop()
  scheduler.start()
  assert.equal(plans.get(id2).state, 'cancelled')
})
