import { randomUUID } from 'node:crypto'
import { validateProviderBaseUrl } from '../secrets/provider-network.js'

export function registerProviderRoutes(app, { db }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/providers', async () => {
      const rows = db.prepare('SELECT * FROM providers ORDER BY created_at DESC').all()
      return {
        data: rows.map((row) => ({
          id: row.id,
          name: row.name,
          baseUrl: row.base_url,
          capabilities: JSON.parse(row.capability_json),
          enabled: Boolean(row.enabled),
        })),
      }
    })

    scope.post(
      '/api/v1/providers',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'baseUrl'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 64 },
              baseUrl: { type: 'string', minLength: 1, maxLength: 500 },
              capabilities: { type: 'array', items: { type: 'string' } },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const baseUrl = validateProviderBaseUrl(request.body.baseUrl)
          const id = randomUUID()
          const now = Date.now()
          db.prepare(
            'INSERT INTO providers (id, name, base_url, capability_json, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
          ).run(
            id,
            request.body.name,
            baseUrl,
            JSON.stringify(request.body.capabilities || []),
            request.body.enabled === undefined || request.body.enabled ? 1 : 0,
            now,
            now,
          )
          return reply.code(201).send({ data: { id, name: request.body.name, baseUrl } })
        } catch (error) {
          return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
        }
      },
    )
  })
}
