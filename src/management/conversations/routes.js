import { requireCapability } from '../auth/authorization.js'

function serializeConversation(row) {
  return {
    id: row.id,
    botAccountId: row.bot_account_id,
    scene: row.scene,
    peerId: row.peer_id,
    senderId: row.sender_id,
    agentId: row.agent_id,
    epoch: row.current_epoch,
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  }
}

function serializeMessage(row) {
  return {
    id: row.id,
    epoch: row.epoch,
    runId: row.run_id,
    role: row.role,
    text: JSON.parse(row.content_json).text,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at,
  }
}

export function registerConversationRoutes(app, { conversations }) {
  app.get(
    '/api/v1/conversations',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            botAccountId: { type: 'string' },
            scene: { type: 'string', enum: ['group', 'private'] },
            peerId: { type: 'string' },
            senderId: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      await requireCapability({ resourceType: 'conversations', operation: 'read:conversations' })(request, reply)
      if (reply.sent) return
      const { rows, next } = conversations.list(request.query)
      return { data: rows.map(serializeConversation), meta: { nextCursor: next } }
    },
  )

  app.get('/api/v1/conversations/:id/messages', async (request, reply) => {
    await requireCapability({ resourceType: 'conversations', resourceId: request.params.id, operation: 'read:conversations' })(request, reply)
    if (reply.sent) return
    if (!conversations.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } })
    const { rows, next } = conversations.messages(request.params.id, request.query)
    return { data: rows.map(serializeMessage), meta: { nextCursor: next } }
  })

  app.post('/api/v1/conversations/:id/reset-context', async (request, reply) => {
    await requireCapability({ resourceType: 'conversations', resourceId: request.params.id, operation: 'write:conversations' })(request, reply)
    if (reply.sent) return
    const result = conversations.reset({ conversationId: request.params.id, actor: request.auth.user.userId })
    if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } })
    return { data: result }
  })

  app.delete('/api/v1/conversations/:id/messages', async (request, reply) => {
    await requireCapability({ resourceType: 'conversations', resourceId: request.params.id, operation: 'write:conversations' })(request, reply)
    if (reply.sent) return
    const result = conversations.deleteMessages(request.params.id)
    if (!result) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } })
    return { data: result }
  })

  app.post('/api/v1/conversations/:id/export', async (request, reply) => {
    await requireCapability({ resourceType: 'conversations', resourceId: request.params.id, operation: 'read:conversations' })(request, reply)
    if (reply.sent) return
    if (!conversations.get(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'conversation not found' } })
    const data = conversations.export(request.params.id)
    return { data: { conversationId: request.params.id, messages: data } }
  })
}
