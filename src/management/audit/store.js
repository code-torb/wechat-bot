import { randomUUID } from 'node:crypto'

export function createAuditStore(db) {
  return {
    record({ actorType, actorId = '', action, resourceType, resourceId = '', traceId, beforeRevision, afterRevision, result = 'ok' }) {
      db.prepare(
        'INSERT INTO audit_events (id, actor_type, actor_id, action, resource_type, resource_id, trace_id, before_revision, after_revision, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        randomUUID(),
        actorType,
        actorId,
        action,
        resourceType,
        resourceId,
        traceId || null,
        beforeRevision ?? null,
        afterRevision ?? null,
        result,
        Date.now(),
      )
    },
    list({ cursor, limit = 50 } = {}) {
      const where = []
      const params = []
      if (cursor) {
        where.push('created_at < ? OR (created_at = ? AND id < ?)')
        const [time, id] = cursor.split(':')
        params.push(Number(time), Number(time), id)
      }
      params.push(limit + 1)
      const sql = `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`
      const rows = db.prepare(sql).all(...params)
      const next = rows.length > limit ? `${rows[limit - 1].created_at}:${rows[limit - 1].id}` : null
      return { rows: rows.slice(0, limit), next }
    },
  }
}
