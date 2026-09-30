import { createQQSetup, serializeRule } from './setup.js'

const scopeTypeSchema = { type: 'string', enum: ['group', 'private', 'group_user'] }
const agentBindingSchema = {
  type: 'object',
  required: ['scopeType', 'scopeKey', 'agentId'],
  additionalProperties: false,
  properties: { scopeType: scopeTypeSchema, scopeKey: { type: 'string' }, agentId: { type: 'string' } },
}
const accessRuleSchema = {
  type: 'object',
  required: ['scopeType', 'scopeKey', 'allow', 'maxLevel'],
  additionalProperties: false,
  properties: {
    scopeType: scopeTypeSchema,
    scopeKey: { type: 'string' },
    allow: { type: 'boolean' },
    trigger: {
      type: 'object',
      additionalProperties: false,
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
}

export function registerQQRoutes(
  app,
  { db, grants, audit, qqRules, qqRouter, service, napcatWebUi, napcatConnection, getOneBotClient, ensureBotAccount },
) {
  const setup = createQQSetup({ db, qqRules, grants, service })
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/qq/accounts', async () => ({
      data: qqRules.accounts().map((row) => ({
        id: row.id,
        selfId: row.self_id,
        enabled: Boolean(row.enabled),
        defaultAgentId: row.default_agent_id,
      })),
    }))

    scope.patch(
      '/api/v1/qq/accounts/:id',
      {
        schema: {
          body: {
            type: 'object',
            required: ['defaultAgentId'],
            additionalProperties: false,
            properties: { defaultAgentId: { type: ['string', 'null'] } },
          },
        },
      },
      async (request, reply) => {
        if (!qqRules.account(request.params.id)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'account not found' } })
        const agentId = request.body.defaultAgentId
        if (agentId && (service.get(agentId)?.status !== 'active' || !service.getPublished(agentId))) {
          return reply.code(422).send({ error: { code: 'VALIDATION', message: '请先发布并启用选定的 Agent' } })
        }
        const account = qqRules.setDefaultAgent(request.params.id, agentId)
        return { data: { id: account.id, selfId: account.self_id, enabled: Boolean(account.enabled), defaultAgentId: account.default_agent_id } }
      },
    )

    scope.get('/api/v1/qq/login', async () => {
      const status = await napcatWebUi.status()
      const identity = getOneBotClient?.()?.identity
      const selfId = status.isLogin ? status.selfId || identity?.selfId || '' : ''
      const accountId = status.isLogin && selfId ? ensureBotAccount(selfId) : null
      const oneBotReady = Boolean(status.isLogin && !status.isOffline && identity && identity.selfId === selfId)
      return { data: { ...status, selfId, accountId, oneBotReady } }
    })

    scope.post('/api/v1/qq/login/refresh', async () => ({ data: await napcatWebUi.refresh() }))
    scope.post(
      '/api/v1/qq/login/verify',
      {
        schema: {
          body: {
            type: 'object',
            required: ['totpCode'],
            additionalProperties: false,
            properties: { totpCode: { type: 'string', pattern: '^[0-9]{6}$' } },
          },
        },
      },
      async (request) => {
        await napcatWebUi.verify(request.body.totpCode)
        return { data: { verified: true } }
      },
    )

    scope.get('/api/v1/qq/connection', async () => ({ data: await napcatConnection.status() }))
    scope.post(
      '/api/v1/qq/connection/websocket',
      {
        schema: {
          body: {
            type: 'object',
            required: ['revision'],
            additionalProperties: false,
            properties: { revision: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
          },
        },
      },
      async (request) => ({ data: await napcatConnection.ensureWebSocket(request.body.revision) }),
    )

    scope.get('/api/v1/qq/accounts/:id/setup', async (request) => ({ data: setup.read(request.params.id) }))
    scope.put(
      '/api/v1/qq/accounts/:id/setup',
      {
        schema: {
          body: {
            type: 'object',
            required: ['revision', 'defaultAgentId', 'rules', 'bindings', 'grants'],
            additionalProperties: false,
            properties: {
              revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              defaultAgentId: { type: 'string', minLength: 1 },
              rules: { type: 'array', maxItems: 200, items: accessRuleSchema },
              bindings: { type: 'array', maxItems: 200, items: agentBindingSchema },
              grants: {
                type: 'array',
                maxItems: 500,
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
      async (request) => {
        const result = setup.save({ accountId: request.params.id, ...request.body })
        audit?.record({
          actorType: 'admin',
          actorId: request.auth.user.userId,
          action: 'qq.setup.update',
          resourceType: 'bot_accounts',
          resourceId: request.params.id,
        })
        return { data: result }
      },
    )

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
        return { data: { accepted: result.accepted, reason: result.reason, agentId: result.agentId || null, maxLevel: result.maxLevel ?? null } }
      },
    )
  })
}
