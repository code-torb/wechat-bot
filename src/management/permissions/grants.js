import { randomUUID } from 'node:crypto'

export function createGrantRepository(db) {
  return {
    list({ botAccountId, scene, peerId, senderId } = {}) {
      const where = []
      const params = []
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
      const sql = `SELECT * FROM principal_grants ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`
      return db.prepare(sql).all(...params)
    },
    upsert({ botAccountId, scene, peerId, senderId, capability, resourceId = '' }) {
      db.prepare(
        'INSERT INTO principal_grants (id, bot_account_id, scene, peer_id, sender_id, capability, resource_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bot_account_id, scene, peer_id, sender_id, capability, resource_id) DO NOTHING',
      ).run(randomUUID(), botAccountId, scene, peerId, senderId, capability, resourceId, Date.now())
    },
    remove({ botAccountId, scene, peerId, senderId, capability, resourceId = '' }) {
      db.prepare(
        'DELETE FROM principal_grants WHERE bot_account_id = ? AND scene = ? AND peer_id = ? AND sender_id = ? AND capability = ? AND resource_id = ?',
      ).run(botAccountId, scene, peerId, senderId, capability, resourceId)
    },
  }
}
