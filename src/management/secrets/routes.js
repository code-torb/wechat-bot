import { randomUUID } from 'node:crypto'

const metadataRow = (row) => ({
  id: row.id,
  providerId: row.provider_id,
  purpose: row.purpose,
  enabled: Boolean(row.enabled),
  keyVersion: row.key_version,
  updatedAt: row.updated_at,
})

export function registerCredentialRoutes(app, { db, secretStore }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/credentials', async () => {
      const rows = db.prepare('SELECT * FROM credentials ORDER BY updated_at DESC').all()
      return { data: rows.map(metadataRow) }
    })

    scope.get('/api/v1/credentials/:id', async (request, reply) => {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'credential not found' } })
      return { data: metadataRow(row) }
    })

    scope.post(
      '/api/v1/credentials',
      {
        schema: {
          body: {
            type: 'object',
            required: ['providerId', 'purpose', 'value'],
            properties: {
              providerId: { type: 'string' },
              purpose: { type: 'string', enum: ['model', 'search', 'embedding'] },
              value: { type: 'string', minLength: 1, maxLength: 4096 },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(request.body.providerId)
        if (!provider) return reply.code(422).send({ error: { code: 'UNKNOWN_PROVIDER', message: 'provider does not exist' } })
        const id = randomUUID()
        const now = Date.now()
        const envelope = secretStore.encrypt({
          record: { id, provider_id: request.body.providerId, purpose: request.body.purpose, key_version: secretStore.keyVersion },
          plaintext: request.body.value,
        })
        db.prepare(
          'INSERT INTO credentials (id, provider_id, purpose, cipher, nonce, tag, key_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          request.body.providerId,
          request.body.purpose,
          envelope.cipher,
          envelope.nonce,
          envelope.tag,
          envelope.keyVersion,
          request.body.enabled === undefined || request.body.enabled ? 1 : 0,
          now,
          now,
        )
        const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id)
        return reply.code(201).send({ data: metadataRow(row) })
      },
    )

    scope.patch('/api/v1/credentials/:id', async (request, reply) => {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'credential not found' } })
      const patch = request.body || {}
      const now = Date.now()
      if (typeof patch.value === 'string' && patch.value.length > 0) {
        const envelope = secretStore.encrypt({ record: row, plaintext: patch.value })
        db.prepare('UPDATE credentials SET cipher = ?, nonce = ?, tag = ?, key_version = ?, updated_at = ? WHERE id = ?').run(
          envelope.cipher,
          envelope.nonce,
          envelope.tag,
          envelope.keyVersion,
          now,
          row.id,
        )
      }
      if (patch.enabled !== undefined) {
        db.prepare('UPDATE credentials SET enabled = ?, updated_at = ? WHERE id = ?').run(patch.enabled ? 1 : 0, now, row.id)
      }
      const updated = db.prepare('SELECT * FROM credentials WHERE id = ?').get(row.id)
      return { data: metadataRow(updated) }
    })

    scope.delete('/api/v1/credentials/:id', async (request, reply) => {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'credential not found' } })
      db.prepare('DELETE FROM credentials WHERE id = ?').run(row.id)
      return { data: { id: row.id, deleted: true } }
    })

    scope.post('/api/v1/credentials/:id/test', async (request, reply) => {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(request.params.id)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'credential not found' } })
      try {
        secretStore.withSecret(row, () => {})
        return { data: { ok: true, method: 'local-integrity' } }
      } catch {
        return reply.code(500).send({ error: { code: 'CREDENTIAL_DECRYPT_FAILED', message: 'stored credential cannot be decrypted' } })
      }
    })
  })
}
