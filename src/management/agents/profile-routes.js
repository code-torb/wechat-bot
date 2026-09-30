import { requireCapability } from '../auth/authorization.js'

function serializeAgent(agent) {
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

function replyOf(error) {
  const status = error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : 422
  return { status, body: { error: { code: error.code || 'VALIDATION', message: error.message } } }
}

export function registerProfileRoutes(app, { service, profileService }) {
  app.get('/api/v1/agents/:id/profile', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    const agent = service.get(request.params.id)
    if (!agent) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return {
      data: {
        attributes: JSON.parse(agent.draft_json).attributes || {},
        relations: profileService.listRelations(request.params.id),
        knowledgeDocs: profileService.listKnowledgeDocs(request.params.id),
      },
    }
  })

  app.get('/api/v1/agents/:id/graph', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return { data: profileService.listGraph(request.params.id) }
  })

  app.post(
    '/api/v1/agents/:id/relations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['personName'],
          additionalProperties: false,
          properties: {
            personName: { type: 'string', minLength: 1, maxLength: 80 },
            relation: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
      try {
        const data = profileService.upsertRelation({
          agentId: request.params.id,
          personName: request.body.personName,
          relation: request.body.relation || '',
          actorId: request.auth.user.userId,
        })
        return reply.code(201).send({ data })
      } catch (error) {
        return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
      }
    },
  )

  app.patch(
    '/api/v1/agents/:id/relations/:relationId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['relation'],
          additionalProperties: false,
          properties: { relation: { type: 'string', maxLength: 4000 } },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      try {
        const data = profileService.updateRelation({
          agentId: request.params.id,
          relationId: request.params.relationId,
          relation: request.body.relation,
          actorId: request.auth.user.userId,
        })
        return { data }
      } catch (error) {
        const { status, body } = replyOf(error)
        return reply.code(status).send(body)
      }
    },
  )

  app.delete('/api/v1/agents/:id/relations/:relationId', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    profileService.removeRelation({
      agentId: request.params.id,
      relationId: request.params.relationId,
      actorId: request.auth.user.userId,
    })
    return { data: { id: request.params.relationId } }
  })

  app.post('/api/v1/agents/:id/relations/:relationId/refresh', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    try {
      const data = await profileService.refreshRelation({
        agentId: request.params.id,
        relationId: request.params.relationId,
      })
      return { data: data || null }
    } catch (error) {
      const { status, body } = replyOf(error)
      return reply.code(status).send(body)
    }
  })

  app.post('/api/v1/agents/:id/relations/refresh-all', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    try {
      const updated = await profileService.refreshAllRelations({
        agentId: request.params.id,
        actorId: request.auth.user.userId,
      })
      return { data: { updated } }
    } catch (error) {
      const { status, body } = replyOf(error)
      return reply.code(status).send(body)
    }
  })

  app.get('/api/v1/agents/:id/knowledge-docs', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'read:agents' })(request, reply)
    if (reply.sent) return
    if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
    return { data: profileService.listKnowledgeDocs(request.params.id) }
  })

  app.post(
    '/api/v1/agents/:id/knowledge-docs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'dataBase64'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120 },
            dataBase64: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      if (!service.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'agent not found' } })
      try {
        const content = Buffer.from(request.body.dataBase64, 'base64').toString('utf8')
        const data = await profileService.addKnowledgeDoc({
          agentId: request.params.id,
          title: request.body.title,
          content,
          actorId: request.auth.user.userId,
        })
        return reply.code(201).send({ data })
      } catch (error) {
        return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
      }
    },
  )

  app.delete('/api/v1/agents/:id/knowledge-docs/:docId', async (request, reply) => {
    await requireCapability({ resourceType: 'agents', resourceId: request.params.id, operation: 'write:agents' })(request, reply)
    if (reply.sent) return
    profileService.removeKnowledgeDoc({
      agentId: request.params.id,
      docId: request.params.docId,
      actorId: request.auth.user.userId,
    })
    return { data: { id: request.params.docId } }
  })

  app.post(
    '/api/v1/agents/story/analyze',
    {
      schema: {
        body: {
          type: 'object',
          required: ['dataBase64'],
          additionalProperties: false,
          properties: {
            dataBase64: { type: 'string', minLength: 1 },
            fileName: { type: 'string', maxLength: 200 },
            nameHint: { type: 'string', maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      request.resultMessage = '已识别小说主要人物'
      try {
        const data = await profileService.analyzeStory({
          dataBase64: request.body.dataBase64,
          fileName: request.body.fileName || '',
          nameHint: request.body.nameHint || '',
        })
        return { data }
      } catch (error) {
        return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
      }
    },
  )

  app.post(
    '/api/v1/agents/from-story',
    {
      schema: {
        body: {
          type: 'object',
          required: ['dataBase64'],
          additionalProperties: false,
          properties: {
            dataBase64: { type: 'string', minLength: 1 },
            fileName: { type: 'string', maxLength: 200 },
            nameHint: { type: 'string', maxLength: 80 },
            characterName: { type: 'string', maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'agents', operation: 'write:agents' })(request, reply)
      if (reply.sent) return
      request.resultMessage = '已根据小说创建角色，原文已入库，关系图谱已生成'
      try {
        const agent = await profileService.createFromStory({
          dataBase64: request.body.dataBase64,
          fileName: request.body.fileName || '',
          nameHint: request.body.nameHint || '',
          characterName: request.body.characterName || '',
          actorId: request.auth.user.userId,
        })
        return reply.code(201).send({ data: serializeAgent(agent) })
      } catch (error) {
        return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
      }
    },
  )
}
