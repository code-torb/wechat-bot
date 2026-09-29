import Fastify from 'fastify'

export async function createApp({ db, clock = Date.now, logger = true }) {
  const app = Fastify({ logger })

  app.addHook('onClose', async () => {
    if (db && typeof db.close === 'function') db.close()
  })

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/v1/status', async () => ({
    data: {
      status: 'ok',
      now: clock(),
      migrations: db?.prepare('SELECT MAX(version) AS version FROM migrations').get()?.version ?? null,
    },
  }))

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed')
    const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INTERNAL'
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
    reply.status(statusCode).send({ error: { code, message: error.exposeMessage || 'request failed' } })
  })

  return app
}
