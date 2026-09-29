import { randomUUID } from 'node:crypto'

export class StyleConflictError extends Error {
  constructor(message) {
    super(message)
    this.code = 'CONFLICT'
  }
}

export function createStyleRepository(db) {
  function keyTaken(key, ownerAgentId, excludeId) {
    const params = [key]
    let sql = 'SELECT COUNT(*) AS count FROM style_definitions WHERE key = ?'
    if (ownerAgentId) {
      sql += ' AND owner_agent_id = ?'
      params.push(ownerAgentId)
    } else {
      sql += ' AND owner_agent_id IS NULL'
    }
    if (excludeId) {
      sql += ' AND id != ?'
      params.push(excludeId)
    }
    return Number(db.prepare(sql).get(...params).count) > 0
  }

  return {
    create({ key, name, description, defaultValue, lowText, midText, highText, ownerAgentId = null, sortOrder = 0 }) {
      if (keyTaken(key, ownerAgentId)) throw new StyleConflictError('definition key already exists in this scope')
      const id = randomUUID()
      const versionId = randomUUID()
      const now = Date.now()
      db.transaction(() => {
        db.prepare(
          'INSERT INTO style_definitions (id, key, owner_agent_id, enabled, revision, activation_generation, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1, ?, ?)',
        ).run(id, key, ownerAgentId, now, now)
        db.prepare(
          'INSERT INTO style_definition_versions (id, definition_id, version, name, description, default_value, low_text, mid_text, high_text, sort_order, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(versionId, id, name, description || '', defaultValue, lowText, midText, highText, sortOrder, now)
      })()
      return { id, versionId }
    },
    get(id) {
      return db.prepare('SELECT * FROM style_definitions WHERE id = ?').get(id)
    },
    currentVersion(id) {
      return db.prepare('SELECT * FROM style_definition_versions WHERE definition_id = ? ORDER BY version DESC LIMIT 1').get(id)
    },
    versions(id) {
      return db.prepare('SELECT * FROM style_definition_versions WHERE definition_id = ? ORDER BY version DESC').all(id)
    },
    list({ ownerAgentId } = {}) {
      const rows = db.prepare('SELECT * FROM style_definitions ORDER BY created_at DESC').all()
      return rows.map((row) => ({ ...row, currentVersion: this.currentVersion(row.id) }))
    },
    addVersion({ definitionId, name, description, defaultValue, lowText, midText, highText, sortOrder = 0 }) {
      const definition = this.get(definitionId)
      if (!definition) throw new StyleConflictError('definition not found')
      const next =
        Number(db.prepare('SELECT MAX(version) AS version FROM style_definition_versions WHERE definition_id = ?').get(definitionId).version) + 1
      const versionId = randomUUID()
      const now = Date.now()
      db.transaction(() => {
        db.prepare(
          'INSERT INTO style_definition_versions (id, definition_id, version, name, description, default_value, low_text, mid_text, high_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(versionId, definitionId, next, name, description || '', defaultValue, lowText, midText, highText, sortOrder ?? 0, now)
        db.prepare('UPDATE style_definitions SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now, definitionId)
      })()
      return { id: versionId, version: next }
    },
    setEnabled({ definitionId, enabled }) {
      const definition = this.get(definitionId)
      if (!definition) throw new StyleConflictError('definition not found')
      const now = Date.now()
      db.prepare(
        'UPDATE style_definitions SET enabled = ?, activation_generation = activation_generation + 1, revision = revision + 1, updated_at = ? WHERE id = ?',
      ).run(enabled ? 1 : 0, now, definitionId)
      return this.get(definitionId)
    },
    setAgentValue({ agentId, definitionId, definitionVersionId, value }) {
      const version = db.prepare('SELECT * FROM style_definition_versions WHERE id = ? AND definition_id = ?').get(definitionVersionId, definitionId)
      if (!version) throw new StyleConflictError('style definition version does not belong to the definition')
      const definition = this.get(definitionId)
      if (!definition || !definition.enabled) throw new StyleConflictError('style definition is missing or disabled')
      db.prepare(
        'INSERT INTO agent_style_values (agent_id, definition_id, definition_version_id, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent_id, definition_id) DO UPDATE SET definition_version_id = excluded.definition_version_id, value = excluded.value, updated_at = excluded.updated_at',
      ).run(agentId, definitionId, definitionVersionId, value, Date.now())
    },
    removeAgentValue({ agentId, definitionId }) {
      db.prepare('DELETE FROM agent_style_values WHERE agent_id = ? AND definition_id = ?').run(agentId, definitionId)
    },
    agentValues(agentId) {
      return db
        .prepare(
          `SELECT v.id AS definition_version_id, v.definition_id, v.name, v.default_value, v.low_text, v.mid_text, v.high_text, s.value
         FROM agent_style_values s
         JOIN style_definition_versions v ON v.id = s.definition_version_id
         WHERE s.agent_id = ?`,
        )
        .all(agentId)
    },
  }
}
