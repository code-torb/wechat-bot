import { randomUUID } from 'node:crypto'
import { validateModelBaseUrl } from '../secrets/provider-network.js'

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    embeddingModel: row.embedding_model,
    hasSearchKey: Boolean(row.search_key_cipher),
    enabled: Boolean(row.enabled),
    keyVersion: row.key_version,
    updatedAt: row.updated_at,
  }
}

export function registerModelRoutes(app, { db, secretStore }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/models', async () => {
      const rows = db.prepare('SELECT * FROM models ORDER BY created_at DESC').all()
      return { data: rows.map(serialize) }
    })

    scope.post(
      '/api/v1/models',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'baseUrl', 'apiKey'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 64 },
              baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
              apiKey: { type: 'string', minLength: 1, maxLength: 4096 },
              searchKey: { type: 'string', maxLength: 4096 },
              embeddingModel: { type: 'string', maxLength: 120 },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const baseUrl = validateModelBaseUrl(request.body.baseUrl)
          const id = randomUUID()
          const now = Date.now()
          const model = {
            id,
            name: request.body.name.trim(),
            base_url: baseUrl,
            embedding_model: (request.body.embeddingModel || '').trim(),
            enabled: request.body.enabled === undefined || request.body.enabled ? 1 : 0,
            key_version: secretStore.keyVersion,
            aad_kind: 'model',
            created_at: now,
            updated_at: now,
          }
          const apiEnvelope = secretStore.encrypt({ record: model, plaintext: request.body.apiKey })
          let searchEnvelope = null
          if (typeof request.body.searchKey === 'string' && request.body.searchKey) {
            searchEnvelope = secretStore.encrypt({
              record: { ...model, key_version: secretStore.keyVersion },
              plaintext: request.body.searchKey,
            })
          }
          db.prepare(
            `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
               search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            model.name,
            baseUrl,
            'model',
            apiEnvelope.cipher,
            apiEnvelope.nonce,
            apiEnvelope.tag,
            apiEnvelope.keyVersion,
            searchEnvelope?.cipher ?? null,
            searchEnvelope?.nonce ?? null,
            searchEnvelope?.tag ?? null,
            searchEnvelope?.keyVersion ?? null,
            model.embedding_model,
            model.enabled,
            now,
            now,
          )
          request.resultMessage = '模型已创建'
          return reply.code(201).send({ data: serialize(db.prepare('SELECT * FROM models WHERE id = ?').get(id)) })
        } catch (error) {
          const status = error.message?.includes('UNIQUE') ? 409 : 422
          return reply.code(status).send({ error: { code: status === 409 ? 'CONFLICT' : 'VALIDATION', message: error.message } })
        }
      },
    )

    scope.patch(
      '/api/v1/models/:id',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 64 },
              baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
              apiKey: { type: 'string', maxLength: 4096 },
              searchKey: { type: 'string', maxLength: 4096 },
              embeddingModel: { type: 'string', maxLength: 120 },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const row = db.prepare('SELECT * FROM models WHERE id = ?').get(request.params.id)
        if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'model not found' } })
        try {
          const patch = request.body || {}
          const now = Date.now()
          const next = { ...row, updated_at: now }
          if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim()
          if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) next.base_url = validateModelBaseUrl(patch.baseUrl)
          if (typeof patch.embeddingModel === 'string') next.embedding_model = patch.embeddingModel.trim()
          if (patch.enabled !== undefined) next.enabled = patch.enabled ? 1 : 0
          let apiEnvelope = null
          if (typeof patch.apiKey === 'string' && patch.apiKey) {
            apiEnvelope = secretStore.encrypt({ record: next, plaintext: patch.apiKey })
          }
          let searchEnvelope = null
          if (typeof patch.searchKey === 'string' && patch.searchKey) {
            searchEnvelope = secretStore.encrypt({ record: { ...next, key_version: secretStore.keyVersion }, plaintext: patch.searchKey })
          }
          db.prepare(
            `UPDATE models SET name = ?, base_url = ?, embedding_model = ?, enabled = ?, updated_at = ?,
               api_key_cipher = COALESCE(?, api_key_cipher), api_key_nonce = COALESCE(?, api_key_nonce), api_key_tag = COALESCE(?, api_key_tag), key_version = COALESCE(?, key_version),
               search_key_cipher = COALESCE(?, search_key_cipher), search_key_nonce = COALESCE(?, search_key_nonce), search_key_tag = COALESCE(?, search_key_tag), search_key_version = COALESCE(?, search_key_version)
             WHERE id = ?`,
          ).run(
            next.name,
            next.base_url,
            next.embedding_model,
            next.enabled,
            now,
            apiEnvelope?.cipher ?? null,
            apiEnvelope?.nonce ?? null,
            apiEnvelope?.tag ?? null,
            apiEnvelope?.keyVersion ?? null,
            searchEnvelope?.cipher ?? null,
            searchEnvelope?.nonce ?? null,
            searchEnvelope?.tag ?? null,
            searchEnvelope?.keyVersion ?? null,
            request.params.id,
          )
          request.resultMessage = '模型已更新'
          return { data: serialize(db.prepare('SELECT * FROM models WHERE id = ?').get(request.params.id)) }
        } catch (error) {
          const status = error.message?.includes('UNIQUE') ? 409 : 422
          return reply.code(status).send({ error: { code: status === 409 ? 'CONFLICT' : 'VALIDATION', message: error.message } })
        }
      },
    )

    scope.delete('/api/v1/models/:id', async (request, reply) => {
      const row = db.prepare('SELECT * FROM models WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'model not found' } })
      const draftRef = db
        .prepare("SELECT COUNT(*) AS count FROM agents WHERE json_extract(draft_json, '$.model.modelId') = ?")
        .get(request.params.id).count
      const versionRef = db
        .prepare("SELECT COUNT(*) AS count FROM agent_versions WHERE json_extract(snapshot_json, '$.model.modelId') = ?")
        .get(request.params.id).count
      if (draftRef + versionRef > 0) {
        return reply.code(422).send({ error: { code: 'VALIDATION', message: 'model is still used by agents' } })
      }
      db.prepare('DELETE FROM models WHERE id = ?').run(request.params.id)
      request.resultMessage = '模型已删除'
      return { data: { id: request.params.id, deleted: true } }
    })

    scope.post('/api/v1/models/:id/test', async (request, reply) => {
      const row = db.prepare('SELECT * FROM models WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'model not found' } })
      request.resultMessage = '模型密钥校验通过'
      try {
        secretStore.withSecret(row, () => {})
        return { data: { ok: true, method: 'local-integrity' } }
      } catch {
        return reply.code(500).send({ error: { code: 'MODEL_KEY_FAILED', message: 'stored model key cannot be decrypted' } })
      }
    })
  })
}
