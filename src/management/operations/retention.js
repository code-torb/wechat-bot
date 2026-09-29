export function runRetention({
  db,
  now = Date.now(),
  messageTtlMs = 30 * 24 * 3600 * 1000,
  auditTtlMs = 90 * 24 * 3600 * 1000,
  inboundTtlMs = 7 * 24 * 3600 * 1000,
}) {
  const terminal = "'sent', 'failed', 'unknown', 'cancelled'"
  const runsCutoff = now - messageTtlMs
  db.prepare(`DELETE FROM runs WHERE status IN (${terminal}) AND created_at < ?`).run(runsCutoff)
  db.prepare('DELETE FROM messages WHERE run_id IS NULL AND created_at < ?').run(runsCutoff)
  db.prepare(
    `DELETE FROM conversations
     WHERE updated_at < ? AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id)`,
  ).run(runsCutoff)
  db.prepare('DELETE FROM audit_events WHERE created_at < ?').run(now - auditTtlMs)
  db.prepare('DELETE FROM inbound_events WHERE expires_at < ?').run(now - inboundTtlMs)
  return { runsDeleted: db.prepare('SELECT changes() AS changes').get().changes }
}
