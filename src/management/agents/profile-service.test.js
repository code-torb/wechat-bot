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
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 4) })
  const envelope = secretStore.encrypt({ record: { id: 'model-a', aad_kind: 'model', key_version: 1 }, plaintext: 'fixture-key' })
  db.prepare(
    `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
       search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'model', ?, ?, ?, 1, NULL, NULL, NULL, NULL, '', 1, ?, ?)`,
  ).run('model-a', 'test-provider', 'https://model.example.test/v1', envelope.cipher, envelope.nonce, envelope.tag, now, now)
  const audit = createAuditStore(db)
  const service = createAgentService({ db, audit })
  const profileService = createAgentProfileService({
    db,
    service,
    audit,
    complete: async ({ messages }) => ({ text: `生成：${String(messages.at(-1).content).slice(0, 40)}`, toolCalls: [] }),
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
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
      model: { modelId: 'model-a', name: 'test-model', supportsTools: false },
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
  const staleAt = created.updatedAt - 1000
  db.prepare('UPDATE agent_relations SET updated_at = ? WHERE id = ?').run(staleAt, created.id)
  const refreshed = await profileService.refreshRelation({ agentId, relationId: created.id })
  assert.match(refreshed.contextDoc, /^生成：/)
  assert.ok(refreshed.updatedAt > staleAt)
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

test('knowledge docs add, list and remove', async (t) => {
  const { db, service, profileService } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const doc = await profileService.addKnowledgeDoc({
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

test('knowledge docs accept content beyond the old 20000 character limit', async (t) => {
  const { db, service, profileService } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const doc = await profileService.addKnowledgeDoc({
    agentId,
    title: '长文档',
    content: '字'.repeat(1200000),
    actorId: 'owner-1',
  })
  assert.equal(doc.chars, 1200000)
  assert.equal(profileService.listKnowledgeDocs(agentId)[0].chars, 1200000)
})

test('upload indexes chunks and relation refresh uses retrieved knowledge', async (t) => {
  const { db, service } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const calls = { indexed: 0, retrieved: 0, removed: 0 }
  const knowledge = {
    indexDocument: async () => {
      calls.indexed += 1
    },
    removeDocument: () => {
      calls.removed += 1
    },
    retrieve: async () => {
      calls.retrieved += 1
      return [{ title: '上海往事', content: '她在出版社工作。' }]
    },
  }
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async ({ messages }) => ({ text: `生成：${String(messages.at(-1).content).slice(0, 300)}`, toolCalls: [] }),
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
    knowledge,
  })
  const doc = await profileService.addKnowledgeDoc({ agentId, title: '往事', content: '她在出版社工作。', actorId: 'owner-1' })
  assert.equal(calls.indexed, 1)
  const rel = profileService.upsertRelation({ agentId, personName: '周叙', relation: '', actorId: 'owner-1' })
  const refreshed = await profileService.refreshRelation({ agentId, relationId: rel.id })
  assert.equal(calls.retrieved, 1)
  assert.match(refreshed.contextDoc, /上海往事/)
  profileService.removeKnowledgeDoc({ agentId, docId: doc.id, actorId: 'owner-1' })
  assert.equal(calls.removed, 1)
})

test('refreshAllRelations extracts a validated character graph first', async (t) => {
  const { db, service } = fixture(t)
  const agentId = publishedAgent(t, { db, service })
  const calls = []
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async ({ messages }) => {
      calls.push(String(messages.at(-1).content).slice(0, 40))
      if (calls.length === 1) {
        return {
          text: JSON.stringify({
            persons: [
              { name: '林安宁', summary: '主角', attributes: { occupation: '编辑' } },
              { name: '儿子', summary: '孩子' },
            ],
            relations: [
              { source: '林安宁', target: '儿子', type: '母子', description: '她照顾儿子。', boundary: '注意孩子感受。' },
              { source: '周叙', target: '林安宁', type: '丈夫', description: '无效实体应跳过' },
            ],
          }),
          toolCalls: [],
        }
      }
      return { text: '关系文档', toolCalls: [] }
    },
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
  })
  profileService.upsertRelation({ agentId, personName: '儿子', relation: '', actorId: 'owner-1' })
  const updated = await profileService.refreshAllRelations({ agentId, actorId: 'owner-1' })
  assert.equal(updated, 1)
  const graph = profileService.listGraph(agentId)
  assert.ok(graph.nodes.some((node) => node.name === '林安宁'))
  assert.ok(graph.nodes.some((node) => node.name === '儿子'))
  assert.equal(
    graph.nodes.some((node) => node.name === '周叙'),
    false,
  )
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].relationType, '母子')
  assert.ok(calls.length >= 2)
})

test('createFromStory parses a first-person story into an Agent draft', async (t) => {
  const { db, service, profileService } = fixture(t)
  const text = `我叫沈宁，生于1992年，是一个男生。我大学读的是建筑，后来做了设计师。空闲时我喜欢跑步和摄影。
第一章
沈宁在深圳租了一间小公寓。`
  const agent = await profileService.createFromStory({
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

test('analyzeStory returns model-recognized characters and falls back to rules', async (t) => {
  const { db, service } = fixture(t)
  publishedAgent(t, { db, service })
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async () => ({
      text: JSON.stringify({
        characters: [
          { name: '林安宁', reason: '主角' },
          { name: '周叙', reason: '丈夫' },
        ],
      }),
      toolCalls: [],
    }),
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
  })
  const story = '我叫林安宁，婚后生活围绕儿子和家庭。周叙是她的丈夫。'
  const result = await profileService.analyzeStory({
    dataBase64: Buffer.from(story).toString('base64'),
    fileName: '林安宁.txt',
  })
  assert.ok(result.characters.some((item) => item.name === '林安宁'))
  assert.ok(result.characters.some((item) => item.name === '周叙'))
})

test('createFromStory distills the chosen character, stores the story and builds the graph', async (t) => {
  const { db, service } = fixture(t)
  publishedAgent(t, { db, service })
  const calls = []
  const profileService = createAgentProfileService({
    db,
    service,
    audit: createAuditStore(db),
    complete: async ({ messages }) => {
      calls.push(String(messages.at(-1).content).slice(0, 30))
      if (calls.length === 1) {
        return {
          text: JSON.stringify({
            name: '林安宁',
            birthDate: '1988-05-06',
            gender: '女',
            occupation: '编辑',
            hobbies: '读书',
            background:
              '她曾做图书编辑，婚后辞职在家照顾儿子。后来在社区图书馆认识纪录片摄影师陈屿，两人发生婚外感情；事情传开后与丈夫周叙分居，靠校对零活维持开销，并开始重新找工作。',
          }),
          toolCalls: [],
        }
      }
      return {
        text: JSON.stringify({
          persons: [
            { name: '林安宁', summary: '主角', attributes: {} },
            { name: '周叙', summary: '丈夫', attributes: {} },
          ],
          relations: [{ source: '林安宁', target: '周叙', type: '夫妻', description: '已经分开。' }],
        }),
        toolCalls: [],
      }
    },
    getModel: (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(id),
  })
  const story = '我叫林安宁，婚后生活围绕儿子和家庭。周叙是她的丈夫，两人后来分开。'
  const agent = await profileService.createFromStory({
    dataBase64: Buffer.from(story).toString('base64'),
    fileName: '林安宁.txt',
    characterName: '林安宁',
    actorId: 'owner-1',
  })
  const draft = JSON.parse(agent.draft_json)
  assert.equal(draft.attributes.name, '林安宁')
  assert.equal(draft.attributes.occupation, '编辑')
  assert.match(draft.prompt, /图书编辑/)
  assert.match(draft.prompt, /周叙/)
  const docs = db.prepare('SELECT title FROM agent_knowledge_docs WHERE agent_id = ?').all(agent.id)
  assert.ok(docs.length >= 1)
  assert.equal(docs[0].title, '林安宁')
  const graph = profileService.listGraph(agent.id)
  assert.ok(graph.nodes.some((node) => node.name === '林安宁'))
  assert.ok(graph.nodes.some((node) => node.name === '周叙'))
  assert.equal(graph.edges.length, 1)
  assert.ok(calls.length >= 2)
})
