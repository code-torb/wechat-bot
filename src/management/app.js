import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { SESSION_COOKIE } from './auth/routes.js'
import { loadUser } from './auth/authorization.js'

export async function createApp({ db, clock = Date.now, sessions, logger = true }) {
  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 })
  await app.register(cookie)
  const dist = process.env.MANAGEMENT_DIST
  if (dist && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false })
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
      }
      return reply.sendFile('index.html')
    })
  }

  app.decorateRequest('auth', null)
  app.addHook('preHandler', async (request) => {
    if (!sessions) return
    const token = request.cookies?.[SESSION_COOKIE]
    const session = token ? sessions.validate(token) : null
    if (session) request.auth = { user: loadUser(db, session.user_id), session }
  })

  app.addHook('preHandler', async (request, reply) => {
    if (!sessions || !request.auth?.user) return
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (!unsafe) return
    const csrf = request.headers['x-csrf-token']
    let sameOrigin = !request.headers.origin
    if (request.headers.origin) {
      try {
        sameOrigin = new URL(request.headers.origin).host === request.headers.host
      } catch {
        sameOrigin = false
      }
    }
    if (!sameOrigin || !sessions.checkCsrf(request.auth.session, csrf)) {
      return reply.code(403).send({ error: { code: 'CSRF_REJECTED', message: 'invalid csrf token or origin' } })
    }
  })

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

  app.decorate('db', db)

  function defaultSuccessMessage(request) {
    if (request.url.startsWith('/api/v1/auth/')) return ''
    if (request.method === 'POST') return '操作成功'
    if (request.method === 'PUT' || request.method === 'PATCH') return '更新成功'
    if (request.method === 'DELETE') return '删除成功'
    return ''
  }

  app.addHook('onSend', async (request, reply, payload) => {
    if (payload === undefined || typeof payload !== 'string') return payload
    let parsed
    try {
      parsed = JSON.parse(payload)
    } catch {
      return payload
    }
    if (!parsed || typeof parsed !== 'object') return payload
    if (reply.statusCode >= 400) {
      if (parsed.error && typeof parsed.error === 'object') {
        return JSON.stringify({
          code: parsed.error.code || 'ERROR',
          message: parsed.error.message || '操作失败',
          data: null,
        })
      }
      return payload
    }
    return JSON.stringify({
      code: 0,
      message: request.resultMessage || defaultSuccessMessage(request),
      data: 'data' in parsed ? parsed.data : parsed,
      ...(parsed.meta !== undefined ? { meta: parsed.meta } : {}),
    })
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed')
    if (error.validation?.length) {
      const issue = error.validation[0]
      const field =
        issue.instancePath?.replace(/^\//, '').replaceAll('/', '.') ||
        issue.params?.missingProperty ||
        issue.params?.additionalProperty ||
        error.validationContext ||
        '请求参数'
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `字段 ${field} 无效：${issue.message || '请检查输入'}` } })
    }
    const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INTERNAL'
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
    reply.status(statusCode).send({ error: { code, message: error.exposeMessage || 'request failed' } })
  })

  return app
}
