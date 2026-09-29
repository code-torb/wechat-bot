import { requireCapability } from '../auth/authorization.js'

const scopeTypeSchema = { type: 'string', enum: ['group', 'private', 'group_user'] }

function serializeRule(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    allow: Boolean(row.allow),
    trigger: JSON.parse(row.trigger_json),
    maxLevel: row.max_level,
    pacingOverride: row.pacing_override_json ? JSON.parse(row.pacing_override_json) : null,
    quoteReply: Boolean(row.quote_reply),
  }
}

export function registerQQRoutes(app, { qqRules, qqRouter }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.post(
      '/api/v1/qq/accounts',
      {
        schema: {
          body: {
            type: 'object',
            required: ['platform', 'selfId'],
            additionalProperties: false,
            properties: {
              platform: { type: 'string' },
              selfId: { type: 'string', pattern: '^[0-9]+$' },
              defaultAgentId: { type: ['string', 'null'] },
            },
          },
        },
      },
      async (request, reply) => {
        qqRules.upsertAccount({
          id: crypto.randomUUID(),
          platform: request.body.platform,
          selfId: request.body.selfId,
          defaultAgentId: request.body.defaultAgentId || null,
        })
        const account = qqRules.accountBySelf(request.body.platform, request.body.selfId)
        return reply.code(201).send({ data: account })
      },
    )

    scope.get('/api/v1/qq/accounts/:id/access-rules', async (request, reply) => {
      if (!qqRules.account(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
      return { data: qqRules.rules(request.params.id).map(serializeRule) }
    })

    scope.put(
      '/api/v1/qq/accounts/:id/access-rules',
      {
        schema: {
          body: {
            type: 'object',
            required: ['rules'],
            properties: {
              rules: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['scopeType', 'scopeKey', 'allow'],
                  additionalProperties: false,
                  properties: {
                    scopeType: scopeTypeSchema,
                    scopeKey: { type: 'string', minLength: 1 },
                    allow: { type: 'boolean' },
                    trigger: {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', enum: ['any', 'all'] },
                        mention: { type: 'boolean' },
                        prefix: { type: ['string', 'null'] },
                        phrase: { type: ['string', 'null'] },
                      },
                    },
                    maxLevel: { type: 'integer', minimum: 0, maximum: 3 },
                    pacingOverride: {
                      type: ['object', 'null'],
                      properties: {
                        baseDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
                        charsPerSecond: { type: 'integer', minimum: 0, maximum: 200 },
                        maxDelayMs: { type: 'integer', minimum: 0, maximum: 60000 },
                      },
                    },
                    quoteReply: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        if (!qqRules.account(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
        const accountId = request.params.id
        const incoming = new Set(request.body.rules.map((rule) => `${rule.scopeType}:${rule.scopeKey}`))
        for (const existing of qqRules.rules(accountId)) {
          if (!incoming.has(`${existing.scope_type}:${existing.scope_key}`))
            qqRules.deleteRule({ accountId, scopeType: existing.scope_type, scopeKey: existing.scope_key })
        }
        for (const rule of request.body.rules) {
          qqRules.upsertRule({
            accountId,
            scopeType: rule.scopeType,
            scopeKey: rule.scopeKey,
            allow: rule.allow,
            trigger: rule.trigger || {},
            maxLevel: rule.maxLevel ?? 0,
            pacingOverride: rule.pacingOverride ?? null,
            quoteReply: rule.quoteReply ?? false,
          })
        }
        return { data: qqRules.rules(accountId).map(serializeRule) }
      },
    )

    scope.get('/api/v1/qq/accounts/:id/bindings', async (request, reply) => {
      if (!qqRules.account(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
      return { data: qqRules.bindings(request.params.id) }
    })

    scope.put(
      '/api/v1/qq/accounts/:id/bindings',
      {
        schema: {
          body: {
            type: 'object',
            required: ['bindings'],
            properties: {
              bindings: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['scopeType', 'scopeKey', 'agentId'],
                  additionalProperties: false,
                  properties: { scopeType: scopeTypeSchema, scopeKey: { type: 'string' }, agentId: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        if (!qqRules.account(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
        const accountId = request.params.id
        const incoming = new Set(request.body.bindings.map((binding) => `${binding.scopeType}:${binding.scopeKey}`))
        for (const existing of qqRules.bindings(accountId)) {
          if (!incoming.has(`${existing.scope_type}:${existing.scope_key}`)) {
            qqRules.deleteBinding({ accountId, scopeType: existing.scope_type, scopeKey: existing.scope_key })
          }
        }
        for (const binding of request.body.bindings) {
          qqRules.upsertBinding({ accountId, scopeType: binding.scopeType, scopeKey: binding.scopeKey, agentId: binding.agentId })
        }
        return { data: qqRules.bindings(accountId) }
      },
    )

    scope.post(
      '/api/v1/qq/accounts/:id/route-preview',
      {
        schema: {
          body: {
            type: 'object',
            required: ['scene', 'peerId', 'senderId', 'text'],
            additionalProperties: false,
            properties: {
              scene: { type: 'string', enum: ['group', 'private'] },
              peerId: { type: 'string' },
              senderId: { type: 'string' },
              text: { type: 'string' },
              mentionedSelf: { type: 'boolean' },
              privateSubtype: { type: 'string', enum: ['friend', 'group', 'other'] },
            },
          },
        },
      },
      async (request, reply) => {
        const result = qqRouter.preview({
          botAccountId: request.params.id,
          scene: request.body.scene,
          peerId: request.body.peerId,
          senderId: request.body.senderId,
          text: request.body.text,
          mentionedSelf: Boolean(request.body.mentionedSelf),
          privateSubtype: request.body.privateSubtype || 'friend',
        })
        return { data: { accepted: result.accepted, reason: result.reason, agentId: result.agentId || null, maxLevel: result.maxLevel || null } }
      },
    )
  })
}
