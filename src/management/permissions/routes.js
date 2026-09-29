import { requireCapability } from '../auth/authorization.js'

export function registerPermissionRoutes(app, { grants }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/qq/accounts/:id/grants', async (request, reply) => {
      if (!request.app.db.prepare('SELECT id FROM bot_accounts WHERE id = ?').get(request.params.id)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
      }
      const rows = grants.list({ botAccountId: request.params.id, ...request.query })
      return {
        data: rows.map((row) => ({
          scene: row.scene,
          peerId: row.peer_id,
          senderId: row.sender_id,
          capability: row.capability,
          resourceId: row.resource_id,
        })),
      }
    })

    scope.put(
      '/api/v1/qq/accounts/:id/grants',
      {
        schema: {
          body: {
            type: 'object',
            required: ['grants'],
            properties: {
              grants: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['scene', 'peerId', 'senderId', 'capability'],
                  additionalProperties: false,
                  properties: {
                    scene: { type: 'string', enum: ['group', 'private'] },
                    peerId: { type: 'string' },
                    senderId: { type: 'string' },
                    capability: { type: 'string' },
                    resourceId: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const accountId = request.params.id
        if (!request.app.db.prepare('SELECT id FROM bot_accounts WHERE id = ?').get(accountId)) {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
        }
        const db = request.app.db
        db.transaction(() => {
          db.prepare('DELETE FROM principal_grants WHERE bot_account_id = ?').run(accountId)
          for (const grant of request.body.grants) {
            grants.upsert({
              botAccountId: accountId,
              scene: grant.scene,
              peerId: grant.peerId,
              senderId: grant.senderId,
              capability: grant.capability,
              resourceId: grant.resourceId || '',
            })
          }
        })()
        return { data: grants.list({ botAccountId: accountId }) }
      },
    )
  })
}
