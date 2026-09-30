import { requireCapability } from '../auth/authorization.js'
import { ValidationError } from './repository.js'

const listAgentsSchema = {
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'active', 'disabled', 'archived'] },
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
}

const agentMutationSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 1000 },
      prompt: { type: 'string', minLength: 1, maxLength: 32000 },
      model: {
        type: 'object',
        properties: {
          providerId: { type: 'string' },
          credentialRef: { type: 'string' },
          name: { type: 'string' },
          supportsTools: { type: 'boolean' },
        },
      },
      styleValues: { type: 'array', items: { type: 'object' } },
      pacing: {
        type: ['object', 'null'],
        properties: {
          baseDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
          charsPerSecond: { type: 'integer', minimum: 0, maximum: 200 },
          maxDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
        },
      },
      capabilities: { type: 'array', items: { type: 'string' } },
      searchMode: { type: 'string', enum: ['off', 'command', 'auto'] },
      resourceGrants: { type: 'array', items: { type: 'object' } },
      commandRefs: { type: 'array', items: { type: 'string' } },
    },
  },
}

function serialize(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    revision: agent.revision,
    publishedVersionId: agent.published_version_id,
    draft: JSON.parse(agent.draft_json),
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  }
}

function serializeVersion(version) {
  return {
    id: version.id,
    agentId: version.agent_id,
    version: version.version,
    snapshot: JSON.parse(version.snapshot_json),
    createdAt: version.created_at,
  }
}

export function registerAgentRoutes(app, { service }) {
  app.get('/api/v1/agents', { schema: listAgentsSchema }, async (request, reply) => {
    await requireCapability({ resourceType: 'agents', operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    const { rows, next } = service.list({ status: request.query.status, cursor: request.query.cursor, limit: request.query.limit })
    return { data: rows.map(serialize), meta: { nextCursor: next } }
  })

  app.post(
    '/api/v1/agents',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string' }, description: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const agent = service.create({ name: request.body.name, description: request.body.description || '', actorId: request.auth.user.userId })
        return reply.code(201).send({ data: serialize(agent) })
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error
        return reply.code(422).send({ error: { code: error.code, message: error.message } })
      }
    },
  )

  app.get('/api/v1/agents/:id', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    const agent = service.get(request.params.id)
    if (!agent) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return { data: serialize(agent) }
  })

  app.patch('/api/v1/agents/:id', { schema: agentMutationSchema }, async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    const current = service.get(request.params.id)
    if (!current) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    const expectedRevision = Number(request.headers['if-match'])
    if (!expectedRevision || expectedRevision !== current.revision) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'agent was modified by another editor' } })
    }
    try {
      const updated = service.updateDraft({
        agentId: request.params.id,
        draft: request.body,
        expectedRevision,
        actorId: request.auth.user.userId,
      })
      return { data: serialize(updated) }
    } catch (error) {
      return reply.code(422).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
    }
  })

  app.post(
    '/api/v1/agents/:id/publish',
    {
      schema: { body: { type: 'object', additionalProperties: false, properties: { expectedRevision: { type: 'integer' } } } },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      const current = service.get(request.params.id)
      if (!current) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
      const expectedRevision = request.body?.expectedRevision ?? Number(request.headers['if-match'])
      try {
        const published = service.publish({ agentId: request.params.id, expectedRevision, actorId: request.auth.user.userId })
        return { data: published }
      } catch (error) {
        const status = error.code === 'CONFLICT' ? 409 : 422
        return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )

  app.get('/api/v1/agents/:id/versions', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return { data: service.versions(request.params.id).map(serializeVersion) }
  })

  app.post(
    '/api/v1/agents/:id/rollback',
    {
      schema: {
        body: {
          type: 'object',
          required: ['versionId', 'expectedRevision'],
          additionalProperties: false,
          properties: { versionId: { type: 'string' }, expectedRevision: { type: 'integer' } },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const published = service.rollback({
          agentId: request.params.id,
          versionId: request.body.versionId,
          expectedRevision: request.body.expectedRevision,
          actorId: request.auth.user.userId,
        })
        return { data: published }
      } catch (error) {
        const status = error.code === 'CONFLICT' ? 409 : 422
        return reply.code(status).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )

  app.patch(
    '/api/v1/agents/:id/status',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { type: 'string', enum: ['active', 'disabled', 'archived'] } },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const updated = service.setStatus({ agentId: request.params.id, status: request.body.status, actorId: request.auth.user.userId })
        return { data: serialize(updated) }
      } catch (error) {
        return reply.code(422).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
      }
    },
  )

  app.delete('/api/v1/agents/:id', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    try {
      return { data: service.remove({ agentId: request.params.id, actorId: request.auth.user.userId }) }
    } catch (error) {
      return reply.code(422).send({ error: { code: error.code || 'VALIDATION', message: error.message } })
    }
  })
}
