import { requireCapability } from '../auth/authorization.js'

export function registerAuditRoutes(app, { audit }) {
  app.get('/api/v1/audit-events', async (request, reply) => {
    await requireCapability({ resourceType: 'audit', operation: 'read:audit' })(request, reply)
    if (reply.sent) return
    const { rows, next } = audit.list({ cursor: request.query.cursor, limit: request.query.limit })
    return { data: rows, meta: { nextCursor: next } }
  })
}
