import { verifyPassword } from './passwords.js'
import { loadUser } from './authorization.js'

export const SESSION_COOKIE = 'mgmt_session'

function makeLimiter() {
  const failures = new Map()
  return {
    hit(key) {
      const entry = failures.get(key) || { count: 0, until: 0 }
      if (entry.until > Date.now()) return entry
      entry.count += 1
      if (entry.count >= 5) entry.until = Date.now() + 5 * 60 * 1000
      failures.set(key, entry)
      return entry
    },
    clear(key) {
      failures.delete(key)
    },
  }
}

export function registerAuthRoutes(app, { db, sessions, now = Date.now }) {
  const limiter = makeLimiter()

  app.post(
    '/api/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const key = `${request.ip}:${request.body.username}`
      const limited = limiter.hit(key)
      if (limited.until > now()) {
        return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'too many login attempts' } })
      }
      const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(request.body.username)
      if (!user || user.disabled || !(await verifyPassword(user.password_hash, request.body.password))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'invalid credentials' } })
      }
      limiter.clear(key)
      const session = sessions.create(user.id)
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: request.protocol === 'https',
        path: '/',
        maxAge: Math.floor((session.expiresAt - now()) / 1000),
      })
      return { data: { username: user.username, role: user.role, csrf: session.csrf } }
    },
  )

  app.delete('/api/v1/auth/session', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE]
    if (token) sessions.revoke(token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { data: { loggedOut: true } }
  })

  app.get('/api/v1/auth/me', async (request, reply) => {
    if (!request.auth?.user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
    return { data: { username: request.auth.user.username, role: request.auth.user.role, scopes: request.auth.user.scopes } }
  })
}
