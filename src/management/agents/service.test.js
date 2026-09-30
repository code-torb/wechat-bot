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
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 1) })
  const envelope = secretStore.encrypt({ record: { id: 'model-a', aad_kind: 'model', key_version: 1 }, plaintext: 'fixture-key' })
  db.prepare(
    `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
       search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'model', ?, ?, ?, 1, NULL, NULL, NULL, NULL, '', 1, ?, ?)`,
  ).run('model-a', 'test-provider', 'https://model.example.test/v1', envelope.cipher, envelope.nonce, envelope.tag, now, now)
  const audit = createAuditStore(db)
  return { db, service: createAgentService({ db, audit }), audit }
}

const goodDraft = {
  name: '助手',
  prompt: '你是一个测试助手。',
  model: { modelId: 'model-a', name: 'test-model', supportsTools: false },
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

test('one publish saves the edited role and selected styles atomically', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  const published = service.publish({
    agentId: agent.id,
    expectedRevision: 1,
    actorId: 'owner-1',
    draft: { ...goodDraft, prompt: '林安宁在上海生活，辞职照顾上小学的儿子。', styleValues: [] },
  })
  assert.equal(published.prompt, '林安宁在上海生活，辞职照顾上小学的儿子。')
  assert.deepEqual(published.styleValues, [])
  const saved = service.get(agent.id)
  assert.equal(JSON.parse(saved.draft_json).prompt, published.prompt)
  assert.equal(saved.revision, 3)
  assert.equal(service.versions(agent.id).length, 1)

  assert.throws(
    () =>
      service.publish({
        agentId: agent.id,
        expectedRevision: saved.revision,
        actorId: 'owner-1',
        draft: { prompt: '另一个背景', styleValues: [{ definitionId: 'missing', definitionVersionId: 'missing', value: 0.5 }] },
      }),
    ValidationError,
  )
  assert.equal(service.get(agent.id).revision, saved.revision)
  assert.equal(JSON.parse(service.get(agent.id).draft_json).prompt, published.prompt)
  assert.equal(service.versions(agent.id).length, 1)
  assert.throws(() => service.publish({ agentId: agent.id, expectedRevision: 1, actorId: 'owner-1', draft: { prompt: '过期修改' } }), ConflictError)
})

test('a failed version insert leaves the edited role unpublished and unsaved', (t) => {
  const { db, service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'owner-1' })
  db.exec("CREATE TRIGGER reject_agent_version BEFORE INSERT ON agent_versions BEGIN SELECT RAISE(ABORT, 'version insert failed'); END")
  assert.throws(
    () => service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'owner-1', draft: { prompt: '新的人物背景。' } }),
    /version insert failed/,
  )
  const current = service.get(agent.id)
  assert.equal(current.revision, 2)
  assert.equal(JSON.parse(current.draft_json).prompt, goodDraft.prompt)
  assert.equal(service.getPublished(agent.id), null)
  assert.equal(service.versions(agent.id).length, 0)
})

test('concurrent edits allow only one winner', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'a' })
  assert.throws(() => service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'b' }), ConflictError)
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 2, actorId: 'b' })
})

test('legacy providerId model drafts are normalized to modelId', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({
    agentId: agent.id,
    draft: { ...goodDraft, model: { providerId: 'model-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false } },
    expectedRevision: 1,
    actorId: 'a',
  })
  const saved = JSON.parse(service.get(agent.id).draft_json)
  assert.deepEqual(saved.model, { modelId: 'model-a', name: 'test-model', supportsTools: false })
  const published = service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  assert.equal(published.model.modelId, 'model-a')
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
    draft: { ...goodDraft, model: { ...goodDraft.model, modelId: 'missing' } },
    expectedRevision: 1,
    actorId: 'a',
  })
  assert.throws(() => service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' }), ValidationError)
  db.prepare('UPDATE models SET enabled = 0 WHERE id = ?').run('model-a')
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

test('published agents can be deleted together with their version history', (t) => {
  const { service } = fixture(t)
  const agent = service.create({ name: '助手' })
  service.updateDraft({ agentId: agent.id, draft: goodDraft, expectedRevision: 1, actorId: 'a' })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'a' })
  assert.equal(service.versions(agent.id).length, 1)
  service.remove({ agentId: agent.id, actorId: 'a' })
  assert.equal(service.get(agent.id), undefined)
})
