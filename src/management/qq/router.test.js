import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createQQRouter } from './router.js'
import { createQQRuleRepository } from './rules.js'
import { createAgentService } from '../agents/service.js'
import { createAuditStore } from '../audit/store.js'
import { SecretStore } from '../secrets/store.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'router-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 4) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 },
    plaintext: 'key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const rules = createQQRuleRepository(db)
  rules.upsertAccount({ id: 'bot-a', platform: 'qq-onebot', selfId: '12345' })
  return { db, service, rules, router: createQQRouter({ db, service }) }
}

function publishAgent(service, name) {
  const agent = service.create({ name })
  const draft = {
    name,
    prompt: '测试角色',
    model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
  }
  service.updateDraft({ agentId: agent.id, draft, expectedRevision: 1, actorId: 'a' })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  return { id: agent.id, published: service.getPublished(agent.id) }
}

test('group access is required before any user or group binding applies', (t) => {
  const { router, rules, service } = fixture(t)
  const agent = publishAgent(service, 'bound')
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group_user', scopeKey: '34567:23456', agentId: agent.id })
  const denied = router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: 'hi', mentionedSelf: true })
  assert.deepEqual({ accepted: denied.accepted, reason: denied.reason }, { accepted: false, reason: 'not_allowlisted' })
  rules.upsertRule({
    accountId: 'bot-a',
    scopeType: 'group',
    scopeKey: '34567',
    allow: true,
    trigger: { mention: true },
    maxLevel: 0,
  })
  const allowed = router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: 'hi', mentionedSelf: true })
  assert.equal(allowed.accepted, true)
  assert.equal(allowed.agentId, agent.id)
})

test('group_user binding overrides group default; private binding is independent', (t) => {
  const { router, rules, service } = fixture(t)
  const defaultAgent = publishAgent(service, 'default')
  const overrideAgent = publishAgent(service, 'override')
  const privateAgent = publishAgent(service, 'private')
  rules.upsertRule({
    accountId: 'bot-a',
    scopeType: 'group',
    scopeKey: '34567',
    allow: true,
    trigger: { mode: 'any', mention: false, prefix: '小助手' },
    maxLevel: 0,
  })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', agentId: defaultAgent.id })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group_user', scopeKey: '34567:23456', agentId: overrideAgent.id })
  rules.upsertRule({ accountId: 'bot-a', scopeType: 'private', scopeKey: '23456', allow: true, trigger: {}, maxLevel: 1 })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'private', scopeKey: '23456', agentId: privateAgent.id })
  const group = router.preview({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '23456',
    text: '小助手 你好',
    mentionedSelf: false,
  })
  assert.equal(group.accepted, true)
  assert.equal(group.agentId, overrideAgent.id)
  const otherUser = router.preview({
    botAccountId: 'bot-a',
    scene: 'group',
    peerId: '34567',
    senderId: '45678',
    text: '小助手 你好',
    mentionedSelf: false,
  })
  assert.equal(otherUser.agentId, defaultAgent.id)
  const privateChat = router.preview({
    botAccountId: 'bot-a',
    scene: 'private',
    peerId: '23456',
    senderId: '23456',
    text: '你好',
    mentionedSelf: false,
  })
  assert.equal(privateChat.accepted, true)
  assert.equal(privateChat.agentId, privateAgent.id)
  assert.equal(privateChat.maxLevel, 1)
})

test('prefix trigger is bounded, phrase trigger exact, fuzzy substring does not fire', (t) => {
  const { router, rules, service } = fixture(t)
  const defaultAgent = publishAgent(service, 'default')
  rules.upsertRule({
    accountId: 'bot-a',
    scopeType: 'group',
    scopeKey: '34567',
    allow: true,
    trigger: { mode: 'any', mention: false, prefix: '小助手' },
    maxLevel: 0,
  })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', agentId: defaultAgent.id })
  assert.equal(
    router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: '小助手 查天气', mentionedSelf: false })
      .accepted,
    true,
  )
  assert.equal(
    router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: '我不是小助手', mentionedSelf: false })
      .accepted,
    false,
  )
  assert.equal(
    router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: '今天天气如何', mentionedSelf: false })
      .accepted,
    false,
  )
})

test('disabled or unpublished agents never fall back silently', (t) => {
  const { router, rules, service } = fixture(t)
  const agent = service.create({ name: '助手' })
  rules.upsertRule({
    accountId: 'bot-a',
    scopeType: 'group',
    scopeKey: '34567',
    allow: true,
    trigger: { mention: true },
    maxLevel: 0,
  })
  rules.upsertBinding({ accountId: 'bot-a', scopeType: 'group', scopeKey: '34567', agentId: agent.id })
  assert.equal(
    router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: 'hi', mentionedSelf: true }).reason,
    'agent_not_published',
  )
  const draft = {
    name: '助手',
    prompt: '测试',
    model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
  }
  service.updateDraft({ agentId: agent.id, draft, expectedRevision: 1, actorId: 'a' })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  service.setStatus({ agentId: agent.id, status: 'disabled' })
  assert.equal(
    router.preview({ botAccountId: 'bot-a', scene: 'group', peerId: '34567', senderId: '23456', text: 'hi', mentionedSelf: true }).reason,
    'agent_unavailable',
  )
})
