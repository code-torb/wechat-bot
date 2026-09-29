import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createAgentService } from './service.js'
import { createAuditStore } from '../audit/store.js'
import { ConflictError, ValidationError } from './repository.js'
import { SecretStore } from '../secrets/store.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 1) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 },
    plaintext: 'fixture-key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  const audit = createAuditStore(db)
  return { db, service: createAgentService({ db, audit }), audit }
}

const goodDraft = {
  name: '助手',
  prompt: '你是一个测试助手。',
  model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
}

test('draft does not change running config until publish', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手', description: '' })
  const draft = { ...goodDraft, name: '助手' }
  service.updateDraft({ agentId: agent.id, draft, expectedRevision: 1, actorId: 'owner-1' })
  assert.equal(service.getPublished(agent.id), null)
  const published = service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'owner-1' })
  assert.equal(published.name, '助手')
  service.updateDraft({ agentId: agent.id, draft: { ...draft, prompt: '第二版。' }, expectedRevision: 3, actorId: 'owner-1' })
  assert.equal(service.getPublished(agent.id).prompt, '你是一个测试助手。')
  service.publish({ agentId: agent.id, expectedRevision: 4, actorId: 'owner-1' })
  assert.equal(service.getPublished(agent.id).prompt, '第二版。')
})

test('concurrent edits allow only one winner', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'a' })
  assert.throws(() => service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'b' }), ConflictError)
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 2, actorId: 'b' })
})

test('rollback creates a new version instead of rewriting history', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: { ...goodDraft, prompt: 'v1' }, expectedRevision: 1, actorId: 'a' })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  service.updateDraft({ agentId: agent.id, draft: { ...goodDraft, prompt: 'v2' }, expectedRevision: 3, actorId: 'a' })
  const second = service.publish({ agentId: agent.id, expectedRevision: 4, actorId: 'a' })
  const versions = service.versions(agent.id)
  assert.equal(versions.length, 2)
  const rolled = service.rollback({ agentId: agent.id, versionId: versions[1].id, expectedRevision: 5, actorId: 'a' })
  assert.equal(rolled.prompt, 'v1')
  assert.equal(service.versions(agent.id).length, 3)
  assert.equal(service.getPublished(agent.id).prompt, 'v1')
  assert.equal(second.prompt, 'v2')
})

test('publish rejects missing, disabled or foreign model credentials', (t) => {
  const { service, db } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({
    agentId: agent.id,
    draft: { ...goodDraft, model: { ...goodDraft.model, credentialRef: 'missing' } },
    expectedRevision: 1,
    actorId: 'a',
  })
  assert.throws(() => service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' }), ValidationError)
  db.prepare('UPDATE credentials SET enabled = 0 WHERE id = ?').run('cred-a')
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 2, actorId: 'a' })
  assert.throws(() => service.publish({ agentId: agent.id, expectedRevision: 3, actorId: 'a' }), ValidationError)
})

test('bound agents cannot be deleted and archived agents stop publishing', (t) => {
  const { service, db } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'a' })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  db.prepare('INSERT INTO bot_accounts (id, platform, self_id, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    'bot-a',
    'qq-onebot',
    '12345',
    Date.now(),
    Date.now(),
  )
  db.prepare('INSERT INTO agent_bindings (id, bot_account_id, scope_type, scope_key, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'binding-1',
    'bot-a',
    'group',
    '34567',
    agent.id,
    Date.now(),
  )
  assert.throws(() => service.remove({ agentId: agent.id }), ValidationError)
  service.archive({ agentId: agent.id })
  assert.equal(service.get(agent.id).status, 'archived')
  assert.throws(() => service.publish({ agentId: agent.id, expectedRevision: service.get(agent.id).revision, actorId: 'a' }), /archived/)
})
