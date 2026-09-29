export function registerMemeRoutes(app, { memes }) {
  app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const user = request.auth?.user
      if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
      if (user.role !== 'owner') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'owner role required' } })
    })

    scope.get('/api/v1/meme-assets', async () => ({ data: memes.list() }))

    scope.post(
      '/api/v1/meme-assets',
      {
        schema: {
          body: {
            type: 'object',
            required: ['dataBase64'],
            additionalProperties: false,
            properties: {
              dataBase64: { type: 'string', minLength: 1 },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const data = memes.upload({ actor: request.auth.user.userId, dataBase64: request.body.dataBase64, tags: request.body.tags || [] })
          return reply.code(201).send({ data })
        } catch (error) {
          return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } })
        }
      },
    )

    scope.patch(
      '/api/v1/meme-assets/:id',
      {
        schema: {
          body: {
            type: 'object',
            required: ['enabled'],
            additionalProperties: false,
            properties: { enabled: { type: 'boolean' } },
          },
        },
      },
      async (request) => {
        memes.setEnabled({ assetId: request.params.id, enabled: request.body.enabled })
        return { data: { id: request.params.id, enabled: request.body.enabled } }
      },
    )
  })
}
