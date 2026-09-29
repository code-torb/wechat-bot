import { randomUUID } from 'node:crypto'

export function registerFileResourceRoutes(app, { db, approvals }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/file-resources', async () => {
      const rows = db.prepare('SELECT * FROM file_resources ORDER BY created_at DESC').all()
      return {
        data: rows.map((row) => ({
          id: row.id,
          mountAlias: row.mount_alias,
          operations: JSON.parse(row.operations_json),
          allowedExtensions: JSON.parse(row.allowed_extensions_json),
          maxBytes: row.max_bytes,
          dailyWriteLimit: row.daily_write_limit,
          autoApprove: Boolean(row.auto_approve),
          enabled: Boolean(row.enabled),
        })),
      }
    })

    scope.post(
      '/api/v1/file-resources',
      {
        schema: {
          body: {
            type: 'object',
            required: ['mountAlias', 'operations'],
            additionalProperties: false,
            properties: {
              mountAlias: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$' },
              operations: { type: 'array', items: { type: 'string', enum: ['list', 'read', 'create', 'update'] } },
              allowedExtensions: { type: 'array', items: { type: 'string' } },
              maxBytes: { type: 'integer', minimum: 1 },
              dailyWriteLimit: { type: 'integer', minimum: 0 },
              autoApprove: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const id = randomUUID()
        const now = Date.now()
        db.prepare(
          'INSERT INTO file_resources (id, mount_alias, operations_json, allowed_extensions_json, max_bytes, daily_write_limit, auto_approve, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        ).run(
          id,
          request.body.mountAlias,
          JSON.stringify(request.body.operations),
          JSON.stringify(request.body.allowedExtensions || []),
          request.body.maxBytes || 1048576,
          request.body.dailyWriteLimit || 0,
          request.body.autoApprove ? 1 : 0,
          now,
          now,
        )
        return reply.code(201).send({ data: { id, mountAlias: request.body.mountAlias } })
      },
    )

    scope.get('/api/v1/approvals', async () => ({ data: approvals.list() }))

    scope.post(
      '/api/v1/approvals/:id/confirm',
      {
        schema: { body: { type: 'object', additionalProperties: false } },
      },
      async (request, reply) => {
        try {
          const data = approvals.decide({ id: request.params.id, decision: 'approved', actor: request.auth.user.userId })
          return { data }
        } catch (error) {
          return reply.code(409).send({ error: { code: 'CONFLICT', message: error.message } })
        }
      },
    )

    scope.post('/api/v1/approvals/:id/reject', async (request, reply) => {
      const data = approvals.decide({ id: request.params.id, decision: 'rejected', actor: request.auth.user.userId })
      return { data }
    })
  })
}
