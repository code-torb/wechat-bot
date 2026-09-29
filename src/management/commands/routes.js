import { randomUUID } from 'node:crypto'
import { requireCapability } from '../auth/authorization.js'

export function registerCommandRoutes(app, { db, service }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/commands', async () => {
      const rows = db
        .prepare(
          `SELECT c.id, c.name, c.status, c.revision, v.* FROM command_definitions c
           LEFT JOIN command_versions v ON v.id = (SELECT id FROM command_versions WHERE command_id = c.id ORDER BY version DESC LIMIT 1)
           ORDER BY c.created_at DESC`,
        )
        .all()
      return {
        data: rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          aliases: row.aliases_json ? JSON.parse(row.aliases_json) : [],
          executionType: row.execution_type,
          steps: row.steps_json ? JSON.parse(row.steps_json) : [],
          capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : [],
          inputSchema: row.input_schema_json ? JSON.parse(row.input_schema_json) : {},
        })),
      }
    })

    scope.post(
      '/api/v1/commands',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'executionType'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 64 },
              aliases: { type: 'array', items: { type: 'string' } },
              executionType: { type: 'string', enum: ['static', 'model_task', 'workflow'] },
              steps: { type: 'array', maxItems: 5 },
              capabilities: { type: 'array', items: { type: 'string' } },
              inputSchema: { type: 'object' },
            },
          },
        },
      },
      async (request, reply) => {
        const commandId = randomUUID()
        const versionId = randomUUID()
        const now = Date.now()
        db.transaction(() => {
          db.prepare('INSERT INTO command_definitions (id, name, status, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
            commandId,
            request.body.name,
            'active',
            now,
            now,
          )
          db.prepare(
            'INSERT INTO command_versions (id, command_id, version, aliases_json, input_schema_json, execution_type, steps_json, capabilities_json, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)',
          ).run(
            versionId,
            commandId,
            JSON.stringify(request.body.aliases || []),
            JSON.stringify(request.body.inputSchema || {}),
            request.body.executionType,
            JSON.stringify(request.body.steps || []),
            JSON.stringify(request.body.capabilities || []),
            now,
          )
        })()
        return reply.code(201).send({ data: { id: commandId, name: request.body.name } })
      },
    )

    scope.get('/api/v1/agents/:id/commands', async (request, reply) => {
      const agent = service.get(request.params.id)
      if (!agent) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
      return { data: { commandRefs: JSON.parse(agent.draft_json).commandRefs || [] } }
    })

    scope.put(
      '/api/v1/agents/:id/commands',
      {
        schema: {
          body: {
            type: 'object',
            required: ['expectedRevision', 'commandIds'],
            additionalProperties: false,
            properties: {
              expectedRevision: { type: 'integer' },
              commandIds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const updated = service.updateCommands({
            agentId: request.params.id,
            commandIds: request.body.commandIds,
            expectedRevision: request.body.expectedRevision,
            actorId: request.auth.user.userId,
          })
          return { data: { agentRevision: updated.revision, commandRefs: request.body.commandIds } }
        } catch (error) {
          const status = error.code === 'CONFLICT' ? 409 : 422
          return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
        }
      },
    )
  })
}
