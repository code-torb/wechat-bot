import { randomUUID } from 'node:crypto'

export function eventKey(message) {
  return `${message.botAccountId}:${message.scene}:${message.peerId}:${message.senderId}:${message.messageId}`
}

export function createConversationStore(db) {
  return {
    accept({ message, agentId, agentVersionId, status = 'queued' }) {
      const key = eventKey(message)
      const now = Date.now()
      const result = db.transaction(() => {
        try {
          db.prepare('INSERT INTO inbound_events (event_key, received_at, expires_at) VALUES (?, ?, ?)').run(key, now, now + 7 * 24 * 3600 * 1000)
        } catch (error) {
          if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE' && error.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') throw error
          return { duplicate: true }
        }
        let conversation = db
          .prepare('SELECT * FROM conversations WHERE bot_account_id = ? AND scene = ? AND peer_id = ? AND sender_id = ? AND agent_id = ?')
          .get(message.botAccountId, message.scene, message.peerId, message.senderId, agentId)
        if (!conversation) {
          const id = randomUUID()
          db.prepare(
            'INSERT INTO conversations (id, bot_account_id, scene, peer_id, sender_id, agent_id, current_epoch, last_agent_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
          ).run(id, message.botAccountId, message.scene, message.peerId, message.senderId, agentId, agentVersionId || null, now, now)
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
        }
        const runId = randomUUID()
        db.prepare(
          'INSERT INTO runs (id, event_key, conversation_id, epoch, agent_version_id, effective_config_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(runId, key, conversation.id, conversation.current_epoch, agentVersionId || null, '{}', status, now, now)
        db.prepare(
          'INSERT INTO messages (id, conversation_id, epoch, run_id, role, content_json, visibility, delivery_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          randomUUID(),
          conversation.id,
          conversation.current_epoch,
          runId,
          'user',
          JSON.stringify({ text: message.text }),
          'visible',
          'recorded',
          now,
        )
        return { duplicate: false, conversationId: conversation.id, epoch: conversation.current_epoch, runId }
      })()
      return result
    },
    get(conversationId) {
      return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)
    },
    list({ agentId, botAccountId, scene, peerId, senderId, cursor, limit = 30 } = {}) {
      const where = []
      const params = []
      if (agentId) {
        where.push('agent_id = ?')
        params.push(agentId)
      }
      if (botAccountId) {
        where.push('bot_account_id = ?')
        params.push(botAccountId)
      }
      if (scene) {
        where.push('scene = ?')
        params.push(scene)
      }
      if (peerId) {
        where.push('peer_id = ?')
        params.push(peerId)
      }
      if (senderId) {
        where.push('sender_id = ?')
        params.push(senderId)
      }
      if (cursor) {
        where.push('updated_at < ? OR (updated_at = ? AND id < ?)')
        const [time, id] = cursor.split(':')
        params.push(Number(time), Number(time), id)
      }
      params.push(limit + 1)
      const sql = `SELECT * FROM conversations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC LIMIT ?`
      const rows = db.prepare(sql).all(...params)
      const next = rows.length > limit ? `${rows[limit - 1].updated_at}:${rows[limit - 1].id}` : null
      return { rows: rows.slice(0, limit), next }
    },
    messages(conversationId, { cursor, limit = 100 } = {}) {
      const where = ['conversation_id = ?']
      const params = [conversationId]
      if (cursor) {
        where.push('created_at < ? OR (created_at = ? AND id < ?)')
        const [time, id] = cursor.split(':')
        params.push(Number(time), Number(time), id)
      }
      params.push(limit + 1)
      const sql = `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`
      const rows = db.prepare(sql).all(...params)
      const next = rows.length > limit ? `${rows[limit - 1].created_at}:${rows[limit - 1].id}` : null
      return { rows: rows.slice(0, limit).reverse(), next }
    },
    getContext({ conversationId, epoch, maxTurns = 10 }) {
      const rows = db
        .prepare(
          `SELECT role, content_json FROM messages
           WHERE conversation_id = ? AND epoch = ? AND visibility = 'visible'
             AND (
               (role = 'assistant' AND delivery_status = 'sent')
               OR (role = 'user' AND run_id IN (
                 SELECT m2.run_id FROM messages m2
                 WHERE m2.conversation_id = messages.conversation_id AND m2.epoch = messages.epoch
                   AND m2.role = 'assistant' AND m2.delivery_status = 'sent'
               ))
             )
           ORDER BY created_at ASC, id ASC`,
        )
        .all(conversationId, epoch)
      const limit = maxTurns * 2
      const slice = rows.length > limit ? rows.slice(rows.length - limit) : rows
      return slice.map((row) => ({ role: row.role, content: JSON.parse(row.content_json).text }))
    },
    reset({ conversationId, actor }) {
      const conversation = this.get(conversationId)
      if (!conversation) return null
      const epoch = conversation.current_epoch + 1
      db.prepare('UPDATE conversations SET current_epoch = ?, updated_at = ? WHERE id = ?').run(epoch, Date.now(), conversationId)
      if (actor) {
        db.prepare(
          'INSERT INTO audit_events (id, actor_type, actor_id, action, resource_type, resource_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(randomUUID(), 'admin', actor, 'conversation.reset_context', 'conversations', conversationId, 'ok', Date.now())
      }
      return { epoch }
    },
    deleteMessages(conversationId) {
      const conversation = this.get(conversationId)
      if (!conversation) return null
      db.transaction(() => {
        db.prepare('DELETE FROM tool_runs WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)').run(conversationId)
        db.prepare('DELETE FROM runs WHERE conversation_id = ?').run(conversationId)
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
        db.prepare('UPDATE conversations SET current_epoch = current_epoch + 1, updated_at = ? WHERE id = ?').run(Date.now(), conversationId)
      })()
      return { deleted: true }
    },
    export(conversationId) {
      const rows = db
        .prepare(
          'SELECT role, content_json, epoch, delivery_status, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
        )
        .all(conversationId)
      return rows.map((row) => ({
        role: row.role,
        epoch: row.epoch,
        deliveryStatus: row.delivery_status,
        text: JSON.parse(row.content_json).text,
        createdAt: row.created_at,
      }))
    },
  }
}
