import { randomUUID } from 'node:crypto'

export function createApprovalStore(db) {
  return {
    create({ toolRunId, expectedFileHash, contentHash, proposalRef, ttlMs = 10 * 60 * 1000 }) {
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO approvals (id, tool_run_id, expected_file_hash, content_hash, proposal_ref, expires_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, toolRunId, expectedFileHash || null, contentHash, proposalRef, now + ttlMs, 'pending', now, now)
      return id
    },
    list({ status } = {}) {
      const where = []
      const params = []
      if (status) {
        where.push('status = ?')
        params.push(status)
      }
      const sql = `SELECT * FROM approvals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`
      return db.prepare(sql).all(...params)
    },
    get(id) {
      return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id)
    },
    decide({ id, decision, actor }) {
      const row = this.get(id)
      if (!row) throw new Error('approval not found')
      if (row.status !== 'pending') throw new Error('approval is not pending')
      if (row.expires_at <= Date.now()) throw new Error('approval has expired')
      const result = db
        .prepare("UPDATE approvals SET status = ?, decided_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(decision, actor, Date.now(), id)
      if (result.changes !== 1) throw new Error('approval state changed concurrently')
      return this.get(id)
    },
    markExecuted(id) {
      db.prepare("UPDATE approvals SET status = 'executed', updated_at = ? WHERE id = ? AND status = 'approved'").run(Date.now(), id)
    },
  }
}
