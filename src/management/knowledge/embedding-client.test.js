import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { SecretStore } from '../secrets/store.js'
import { createEmbeddingClient } from './embedding-client.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'embedding-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare(
    'INSERT INTO providers (id, name, base_url, embedding_model, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)',
  ).run('provider-e', 'embed', 'https://embed.example.test/v1', 'my-embed-1', '[]', now, now)
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 6) })
  const envelope = secretStore.encrypt({
    record: { id: 'cred-e', provider_id: 'provider-e', purpose: 'embedding', key_version: 1 },
    plaintext: 'embed-key',
  })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run('cred-e', 'provider-e', 'embedding', envelope.cipher, envelope.nonce, envelope.tag, 1, now, now)
  return { db, secretStore }
}

test('embedding client calls the configured model and returns Float32 vectors', async (t) => {
  const { db, secretStore } = fixture(t)
  let requestBody
  const client = createEmbeddingClient({
    db,
    secretStore,
    transport: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
            { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  assert.equal(client.model, 'my-embed-1')
  const vectors = await client.embed(['你好', '世界'])
  assert.equal(vectors.length, 2)
  assert.ok(vectors[0] instanceof Float32Array)
  assert.ok(Math.abs(vectors[1][2] - 0.6) < 1e-6)
  assert.equal(requestBody.model, 'my-embed-1')
  assert.deepEqual(requestBody.input, ['你好', '世界'])
})

test('embedding client is null without a configured embedding credential', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'embedding-empty-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 'test.sqlite') })
  t.after(() => db.close())
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 9) })
  assert.equal(createEmbeddingClient({ db, secretStore }), null)
})
