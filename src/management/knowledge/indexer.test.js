import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { chunkText, cosine, createKnowledgeIndexer } from './indexer.js'

function vectorOf(text, dim = 4) {
  const vec = new Float32Array(dim)
  vec[0] = 1
  for (let i = 0; i < text.length; i += 1) {
    vec[1 + (i % (dim - 1))] += text.charCodeAt(i) / 10000
  }
  return vec
}

const fakeEmbedding = {
  embed: async (texts) => texts.map((text) => vectorOf(text)),
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-indexer-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare('INSERT INTO agents (id, name, status, draft_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    'agent-a',
    'A',
    'active',
    '{}',
    now,
    now,
  )
  db.prepare('INSERT INTO agent_knowledge_docs (id, agent_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'doc-a',
    'agent-a',
    '上海往事',
    '她在出版社工作，后来回家照顾儿子。',
    now,
    now,
  )
  return { db }
}

test('chunkText splits long text with overlap and keeps short text whole', () => {
  const short = chunkText('短短的一段。')
  assert.deepEqual(short, ['短短的一段。'])
  const long = chunkText('甲'.repeat(1400), 600, 100)
  assert.ok(long.length >= 3)
  assert.equal(long[0].length, 600)
})

test('cosine similarity ranks matching vectors higher', () => {
  const a = new Float32Array([1, 2, 3])
  const b = new Float32Array([1, 2, 3])
  const c = new Float32Array([-1, -2, -3])
  assert.ok(cosine(a, b) > 0.99)
  assert.ok(cosine(a, c) < -0.99)
})

test('index and retrieve rank chunks by embedding similarity', async (t) => {
  const { db } = fixture(t)
  const indexer = createKnowledgeIndexer({ db, embedding: fakeEmbedding })
  await indexer.indexDocument({
    agentId: 'agent-a',
    docId: 'doc-a',
    title: '上海往事',
    content: '她在出版社工作，后来回家照顾儿子。' + '更多内容'.repeat(200),
  })
  const rows = db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE agent_id = ?').get('agent-a')
  assert.ok(rows.count >= 2)
  const hits = await indexer.retrieve({ agentId: 'agent-a', query: '出版社工作', topK: 2 })
  assert.ok(hits.length >= 1)
  assert.match(hits[0].content, /出版社/)
  assert.ok(hits[0].score > 0)
})

test('retrieve returns empty when embedding is unavailable', async (t) => {
  const { db } = fixture(t)
  const indexer = createKnowledgeIndexer({ db, embedding: null })
  await indexer.indexDocument({ agentId: 'agent-a', docId: 'doc-a', title: '上海往事', content: '她在出版社工作。' })
  const hits = await indexer.retrieve({ agentId: 'agent-a', query: '出版社' })
  assert.deepEqual(hits, [])
})

test('removeDocument deletes chunks for a doc', async (t) => {
  const { db } = fixture(t)
  const indexer = createKnowledgeIndexer({ db, embedding: fakeEmbedding })
  await indexer.indexDocument({ agentId: 'agent-a', docId: 'doc-a', title: '上海往事', content: '她在出版社工作。' })
  indexer.removeDocument({ docId: 'doc-a' })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE doc_id = ?').get('doc-a').count, 0)
})
