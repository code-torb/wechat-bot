import { requireCapability } from '../auth/authorization.js'
import { validateStyleDefinition, validateAgentPacing } from './compiler.js'

function serializeDefinition(repo, row) {
  const version = repo.currentVersion(row.id)
  return {
    id: row.id,
    key: row.key,
    ownerAgentId: row.owner_agent_id,
    enabled: Boolean(row.enabled),
    revision: row.revision,
    activationGeneration: row.activation_generation,
    currentVersion: version,
  }
}

export function registerStyleRoutes(app, { db, styles, service }) {
  app.get('/api/v1/style-definitions', async (request, reply) => {
    await requireCapability({ resourceType: 'style-definitions', operation: 'read:style-definitions' })(request, reply)
    if (reply.sent) return
    return { data: styles.list().map((row) => serializeDefinition(styles, row)) }
  })

  app.get('/api/v1/style-definitions/:id/versions', async (request, reply) => {
    await requireCapability({ resourceType: 'style-definitions', resourceId: request.params.id, operation: 'read:style-definitions' })(request, reply)
    if (reply.sent) return
    return { data: styles.versions(request.params.id) }
  })

  app.post(
    '/api/v1/style-definitions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'name', 'defaultValue', 'lowText', 'midText', 'highText'],
          additionalProperties: false,
          properties: {
            key: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*$', maxLength: 64 },
            name: { type: 'string', minLength: 1, maxLength: 64 },
            description: { type: 'string', maxLength: 1000 },
            defaultValue: { type: 'number', minimum: 0, maximum: 1 },
            lowText: { type: 'string', minLength: 1, maxLength: 500 },
            midText: { type: 'string', minLength: 1, maxLength: 500 },
            highText: { type: 'string', minLength: 1, maxLength: 500 },
            sortOrder: { type: 'integer' },
            scope: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['global', 'agent'] },
                agentId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const scope = request.body.scope || { type: 'global' }
      const ownerAgentId = scope.type === 'agent' ? scope.agentId : null
      const capability = ownerAgentId
        ? { resourceType: 'agents', resourceId: ownerAgentId, operation: 'write:agents' }
        : { resourceType: 'style-definitions', operation: 'write:style-definitions' }
      await requireCapability(capability)(request, reply)
      if (reply.sent) return
      try {
        const definition = validateStyleDefinition(request.body)
        const created = styles.create({ ...definition, ownerAgentId })
        return reply.code(201).send({ data: serializeDefinition(styles, styles.get(created.id)) })
      } catch (error) {
        const status = error.code === 'CONFLICT' ? 409 : 422
        return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )

  app.patch('/api/v1/style-definitions/:id', async (request, reply) => {
    await requireCapability({ resourceType: 'style-definitions', resourceId: request.params.id, operation: 'write:style-definitions' })(
      request,
      reply,
    )
    if (reply.sent) return
    const definition = styles.get(request.params.id)
    if (!definition) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'definition not found' } })
    const body = request.body || {}
    if (body.enabled !== undefined) {
      const updated = styles.setEnabled({ definitionId: definition.id, enabled: Boolean(body.enabled) })
      return { data: serializeDefinition(styles, updated) }
    }
    try {
      const input = validateStyleDefinition({
        key: definition.key,
        name: body.name || definition.currentVersion.name,
        description: body.description ?? definition.currentVersion.description,
        defaultValue: body.defaultValue ?? definition.currentVersion.default_value,
        lowText: body.lowText || definition.currentVersion.low_text,
        midText: body.midText || definition.currentVersion.mid_text,
        highText: body.highText || definition.currentVersion.high_text,
        sortOrder: body.sortOrder ?? definition.currentVersion.sort_order,
      })
      styles.addVersion({ definitionId: definition.id, ...input })
      return { data: serializeDefinition(styles, styles.get(definition.id)) }
    } catch (error) {
      return reply.code(422).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
    }
  })

  app.get('/api/v1/agents/:id/style-settings', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return { data: { values: styles.agentValues(request.params.id) } }
  })

  app.put(
    '/api/v1/agents/:id/style-settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expectedRevision', 'values'],
          additionalProperties: false,
          properties: {
            expectedRevision: { type: 'integer' },
            values: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['definitionId', 'definitionVersionId', 'value'],
                additionalProperties: false,
                properties: {
                  definitionId: { type: 'string' },
                  definitionVersionId: { type: 'string' },
                  value: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const updated = service.updateStyleSettings({
          agentId: request.params.id,
          values: request.body.values,
          expectedRevision: request.body.expectedRevision,
          actorId: request.auth.user.userId,
        })
        return { data: { agent: updated, values: styles.agentValues(request.params.id) } }
      } catch (error) {
        const status = error.code === 'CONFLICT' ? 409 : 422
        return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )

  app.put(
    '/api/v1/agents/:id/reply-pacing',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: {
            expectedRevision: { type: 'integer' },
            pacing: {
              type: ['object', 'null'],
              properties: {
                baseDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
                charsPerSecond: { type: 'integer', minimum: 0, maximum: 200 },
                maxDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const pacing = request.body.pacing === null ? null : validateAgentPacing(request.body.pacing)
        const updated = service.updatePacing({
          agentId: request.params.id,
          pacing,
          expectedRevision: request.body.expectedRevision,
          actorId: request.auth.user.userId,
        })
        return { data: updated }
      } catch (error) {
        const status = error.code === 'CONFLICT' ? 409 : 422
        return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )
}
