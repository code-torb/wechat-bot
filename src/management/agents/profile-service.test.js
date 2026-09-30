import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createAgentService } from './service.js'
import { createAuditStore } from '../audit/store.js'
import { SecretStore } from '../secrets/store.js'
import { RELATIONS_TTL_MS, createAgentProfileService } from './profile-service.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'profile-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare(
    'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-a', 'test', 'https://model.example.test/v1', '{}', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 4) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 },
    plaintext: 'fixture-key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-a', 'provider-a', 'model', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const profileService = createAgentProfileService({
    db,
    service,
    audit,
    complete: async ({ messages }) => ({ text: `生成：${String(messages.at(-1).content).slice(0, 40)}`, toolCalls: [] }),
    getCredential: (id) => db.prepare('SELECT * FROM credentials WHERE id = ?').get(id),
    getProvider: (id) => db.prepare('SELECT * FROM providers WHERE id = ?').get(id),
  })
  return { db, service, profileService }
}

function publishedAgent(t, { db, service }) {
  const agent = service.create({ name: '林安宁', description: '' })
  service.updateDraft({
    agentId: agent.id,
    draft: {
      name: '林安宁',
      prompt: '她曾做过图书编辑，如今在家照顾儿子。',
      attributes: { name: '林安宁', birthDate: '1988-05-06', gender: '女', occupation: '编辑', hobbies: '读书' },
      model: { providerId: 'provider-a', credentialRef: 'cred-a', name: 'test-model', supportsTools: false },
    },
    expectedRevision: 1,
    actorId: 'owner-1',
  })
  service.publish({ agentId: agent.id, expectedRevision: 2, actorId: 'owner-1' })
  return agent.id
}

test('relations upsert, refresh and delete round trip', async (t) => {
  const { db, service, profileService } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const created = profileService.upsertRelation({ agentId, personName: '周叙', relation: '丈夫，习惯独自决定家里大事', actorId: 'owner-1' })
  assert.equal(created.personName, '周叙')
  assert.equal(created.contextDoc, '')
  const refreshed = await profileService.refreshRelation({ agentId, relationId: created.id })
  assert.match(refreshed.contextDoc, /^生成：/)
  assert.ok(refreshed.updatedAt > created.updatedAt)
  const afterRefresh = profileService.listRelations(agentId)
  assert.equal(afterRefresh[0].contextDoc, refreshed.contextDoc)
  profileService.removeRelation({ agentId, relationId: created.id, actorId: 'owner-1' })
  assert.equal(profileService.listRelations(agentId).length, 0)
})

test('refreshStaleRelations only refreshes relations older than 12 hours', async (t) => {
  const { db, service, profileService } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const fresh = profileService.upsertRelation({ agentId, personName: '儿子', relation: '', actorId: 'owner-1' })
  const stale = profileService.upsertRelation({ agentId, personName: '陈屿', relation: '', actorId: 'owner-1' })
  db.prepare('UPDATE agent_relations SET updated_at = ? WHERE id = ?').run(Date.now() - RELATIONS_TTL_MS - 1000, stale.id)
  const updated = await profileService.refreshStaleRelations({ agentId })
  assert.equal(updated, 1)
  assert.match(db.prepare('SELECT context_doc FROM agent_relations WHERE id = ?').get(stale.id).context_doc, /^生成：/)
  assert.equal(db.prepare('SELECT context_doc FROM agent_relations WHERE id = ?').get(fresh.id).context_doc, '')
})

test('knowledge docs add, list and remove', (t) => {
  const { db, service, profileService } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const doc = profileService.addKnowledgeDoc({
    agentId,
    title: '上海往事',
    content: '她年轻时在出版社工作，婚后把重心放回家庭。',
    actorId: 'owner-1',
  })
  assert.equal(doc.chars > 0, true)
  assert.equal(profileService.listKnowledgeDocs(agentId).length, 1)
  profileService.removeKnowledgeDoc({ agentId, docId: doc.id, actorId: 'owner-1' })
  assert.equal(profileService.listKnowledgeDocs(agentId).length, 0)
})

test('createFromStory parses a first-person story into an Agent draft', (t) => {
  const { db, service, profileService } = fixture(t)
  const text = `我叫沈宁，生于1992年，是一个男生。我大学读的是建筑，后来做了设计师。空闲时我喜欢跑步和摄影。
第一章
沈宁在深圳租了一间小公寓。`
  const agent = profileService.createFromStory({
    dataBase64: Buffer.from(text).toString('base64'),
    fileName: '沈宁.txt',
    nameHint: '',
    actorId: 'owner-1',
  })
  assert.equal(agent.name, '沈宁')
  const draft = JSON.parse(agent.draft_json)
  assert.equal(draft.attributes.name, '沈宁')
  assert.equal(draft.attributes.gender, '男')
  assert.equal(draft.attributes.occupation, '设计师')
  assert.match(draft.attributes.hobbies, /跑步和摄影/)
  assert.match(draft.prompt, /沈宁在深圳/)
})
