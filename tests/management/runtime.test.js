import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/management/db/index.js'
import { createConversationStore } from '../../src/management/conversations/repository.js'
import { createReplyPlanStore } from '../../src/management/runtime/reply-plans.js'
import { createReplyScheduler } from '../../src/management/runtime/scheduler.js'
import { createSessionQueue } from '../../src/management/runtime/session-queue.js'
import { createAgentRuntime } from '../../src/management/runtime/runner.js'
import { createQQRouter } from '../../src/management/qq/router.js'
import { createQQRuleRepository } from '../../src/management/qq/rules.js'
import { createAgentService } from '../../src/management/agents/service.js'
import { createAuditStore } from '../../src/management/audit/store.js'
import { createPolicyEngine } from '../../src/management/permissions/policy.js'
import { createCommandRegistry } from '../../src/management/commands/registry.js'
import { renderReply } from '../../src/platforms/onebot/render.js'
import { SecretStore } from '../../src/management/secrets/store.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 5) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 },
    plaintext: 'key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const agent = service.create({ name: '助手' })
  service.updateDraft({
    agentId: agent.id,
    draft: {
      name: '助手',
      prompt: '你是一个测试助手。',
      model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
      pacing: { baseDelayMs: 100, charsPerSecond: 0, maxDelayMs: 300 },
    },
    expectedRevision: 1,
    actorId: 'a',
  })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  const rules = createQQRuleRepository(db)
  rules.upsertAccount({ id: 'bot-a', platform: 'qq-onebot', selfId: '12345' })
  rules.upsertRule({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', allow: true, trigger: { mention: true }, maxLevel: 0 })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', agentId: agent.id })
  const router = createQQRouter({ db, service })
  const conversations = createConversationStore(db)
  const plans = createReplyPlanStore(db)
  const calls = []
  const client = {
    identity: { selfId: '12345', generation: 1 },
    call: async (action, params) => {
      calls.push({ action, params })
    },
  }
  return { db, service, router, conversations, plans, client, calls, agent }
}

test('full runtime flow sends a paced reply and stores the delivered turn', async (t) => {
  const { db, router, conversations, plans, client, calls, agent } = fixture(t)
  const policyEngine = createPolicyEngine({ db })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine,
    router,
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine,
    scheduler,
    complete: async () => ({ text: '模型回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied', errorCode: 'UNKNOWN_TOOL' }) },
    sessionQueue: createSessionQueue(),
  })
  const result = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(result.status, 'queued')
  const deadline = Date.now() + 3000
  while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.message[0].data.text, '模型回复')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE delivery_status = 'sent'").get().count, 2)
  assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(db.prepare('SELECT id FROM runs LIMIT 1').get().id).status, 'sent')
})

test('/reset cancels the pending reply and answers immediately', async (t) => {
  const { db, router, conversations, plans, client, calls, agent } = fixture(t)
  const policyEngine = createPolicyEngine({ db })
  const scheduler = createReplyScheduler({
    db,
    plans,
    conversations,
    client,
    renderReply,
    policyEngine,
    router,
    intervalMs: 5,
    logger: { error() {} },
  })
  scheduler.start()
  t.after(() => scheduler.stop())
  const runtime = createAgentRuntime({
    db,
    conversations,
    router,
    commandRegistry: createCommandRegistry({ db }),
    policyEngine,
    scheduler,
    complete: async () => ({ text: '慢回复', toolCalls: [] }),
    tools: { execute: async () => ({ status: 'denied', errorCode: 'UNKNOWN_TOOL' }) },
    sessionQueue: createSessionQueue(),
  })
  await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '1',
    text: '你好',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const reset = await runtime.accept({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    messageId: '2',
    text: '/reset',
    mentionedSelf: true,
    privateSubtype: null,
    connectionGeneration: 1,
    receivedAt: Date.now(),
  })
  assert.equal(reset.status, 'queued')
  const deadline = Date.now() + 2000
  while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.message[0].data.text, '已重置这段对话。')
})
