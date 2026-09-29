export class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.code = 'CONFLICT'
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.code = 'VALIDATION'
  }
}

export function createAgentRepository(db) {
  return {
    insert(agent) {
      db.prepare(
        'INSERT INTO agents (id, name, description, status, draft_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      ).run(agent.id, agent.name, agent.description, agent.status, agent.draftJson, agent.createdAt, agent.updatedAt)
      return agent
    },
    get(id) {
      return db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
    },
    list({ status, cursor, limit = 30 } = {}) {
      const where = []
      const params = []
      if (status) {
        where.push('status = ?')
        params.push(status)
      }
      if (cursor) {
        where.push('created_at < ? OR (created_at = ? AND id < ?)')
        const [time, id] = cursor.split(':')
        params.push(Number(time), Number(time), id)
      }
      params.push(limit + 1)
      const sql = `SELECT * FROM agents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`
      const rows = db.prepare(sql).all(...params)
      const next = rows.length > limit ? `${rows[limit - 1].created_at}:${rows[limit - 1].id}` : null
      return { rows: rows.slice(0, limit), next }
    },
    updateDraft({ id, draftJson, expectedRevision, now }) {
      const result = db
        .prepare('UPDATE agents SET draft_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
        .run(draftJson, now, id, expectedRevision)
      if (result.changes !== 1) throw new ConflictError('agent was modified by another editor')
      return this.get(id)
    },
    setStatus({ id, status, now }) {
      db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
      return this.get(id)
    },
    nextVersion(id) {
      const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM agent_versions WHERE agent_id = ?').get(id)
      return Number(row.version) + 1
    },
    insertVersion({ id, agentId, version, snapshotJson, actorId, createdAt }) {
      db.prepare('INSERT INTO agent_versions (id, agent_id, version, snapshot_json, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        agentId,
        version,
        snapshotJson,
        actorId || null,
        createdAt,
      )
    },
    getVersion(id) {
      return db.prepare('SELECT * FROM agent_versions WHERE id = ?').get(id)
    },
    versions(agentId, { limit = 50 } = {}) {
      return db.prepare('SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version DESC LIMIT ?').all(agentId, limit)
    },
    publishPointer({ agentId, versionId, now }) {
      db.prepare('UPDATE agents SET published_version_id = ?, status = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(
        versionId,
        'active',
        now,
        agentId,
      )
    },
    bindingCount(agentId) {
      return Number(db.prepare('SELECT COUNT(*) AS count FROM agent_bindings WHERE agent_id = ?').get(agentId).count)
    },
    hardDelete(id) {
      db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    },
  }
}
