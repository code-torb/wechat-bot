import { randomUUID } from 'node:crypto'

export function createReplyPlanStore(db) {
  return {
    insert({ runId, generation, epoch, reply, pacing, dueAt }) {
      const id = randomUUID()
      db.prepare(
        'INSERT INTO reply_plans (id, run_id, generation, epoch, reply_json, pacing_json, due_at, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, runId, generation, epoch, JSON.stringify(reply), JSON.stringify(pacing), dueAt, 'pending', Date.now())
      return id
    },
    pendingDue(now) {
      return db.prepare("SELECT * FROM reply_plans WHERE state = 'pending' AND due_at <= ? ORDER BY due_at ASC").all(now)
    },
    setState(id, state) {
      db.prepare('UPDATE reply_plans SET state = ?, cancellation_reason = NULL WHERE id = ?').run(state, id)
    },
    cancelForConversation({ conversationId, epoch, reason }) {
      const result = db
        .prepare(
          `UPDATE reply_plans SET state = 'cancelled', cancellation_reason = ?
           WHERE state = 'pending' AND epoch = ?
             AND run_id IN (SELECT id FROM runs WHERE conversation_id = ?)`,
        )
        .run(reason, epoch, conversationId)
      return result.changes
    },
    cancelAll({ reason }) {
      db.prepare("UPDATE reply_plans SET state = 'cancelled', cancellation_reason = ? WHERE state = 'pending'").run(reason)
    },
    get(id) {
      return db.prepare('SELECT * FROM reply_plans WHERE id = ?').get(id)
    },
  }
}
