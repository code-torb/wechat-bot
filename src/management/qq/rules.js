export function createQQRuleRepository(db) {
  return {
    account(id) {
      return db.prepare('SELECT * FROM bot_accounts WHERE id = ?').get(id)
    },
    accountBySelf(platform, selfId) {
      return db.prepare('SELECT * FROM bot_accounts WHERE platform = ? AND self_id = ?').get(platform, selfId)
    },
    upsertAccount({ id, platform, selfId, defaultAgentId = null }) {
      const now = Date.now()
      db.prepare(
        'INSERT INTO bot_accounts (id, platform, self_id, default_agent_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(platform, self_id) DO UPDATE SET default_agent_id = excluded.default_agent_id, updated_at = excluded.updated_at',
      ).run(id, platform, selfId, defaultAgentId, now, now)
    },
    rules(accountId) {
      return db.prepare('SELECT * FROM qq_access_rules WHERE bot_account_id = ?').all(accountId)
    },
    upsertRule({ accountId, scopeType, scopeKey, allow, trigger, maxLevel, pacingOverride, quoteReply }) {
      const now = Date.now()
      db.prepare(
        `INSERT INTO qq_access_rules (id, bot_account_id, scope_type, scope_key, allow, trigger_json, max_level, pacing_override_json, quote_reply, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_account_id, scope_type, scope_key) DO UPDATE SET
           allow = excluded.allow, trigger_json = excluded.trigger_json, max_level = excluded.max_level,
           pacing_override_json = excluded.pacing_override_json, quote_reply = excluded.quote_reply, updated_at = excluded.updated_at`,
      ).run(
        randomUUID(),
        accountId,
        scopeType,
        scopeKey,
        allow ? 1 : 0,
        JSON.stringify(trigger),
        maxLevel,
        pacingOverride ? JSON.stringify(pacingOverride) : null,
        quoteReply ? 1 : 0,
        now,
        now,
      )
    },
    deleteRule({ accountId, scopeType, scopeKey }) {
      db.prepare('DELETE FROM qq_access_rules WHERE bot_account_id = ? AND scope_type = ? AND scope_key = ?').run(accountId, scopeType, scopeKey)
    },
    bindings(accountId) {
      return db.prepare('SELECT * FROM agent_bindings WHERE bot_account_id = ?').all(accountId)
    },
    upsertBinding({ accountId, scopeType, scopeKey, agentId }) {
      db.prepare(
        'INSERT INTO agent_bindings (id, bot_account_id, scope_type, scope_key, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bot_account_id, scope_type, scope_key) DO UPDATE SET agent_id = excluded.agent_id',
      ).run(randomUUID(), accountId, scopeType, scopeKey, agentId, Date.now())
    },
    deleteBinding({ accountId, scopeType, scopeKey }) {
      db.prepare('DELETE FROM agent_bindings WHERE bot_account_id = ? AND scope_type = ? AND scope_key = ?').run(accountId, scopeType, scopeKey)
    },
    bindingByScope({ accountId, scopeType, scopeKey }) {
      return db
        .prepare('SELECT * FROM agent_bindings WHERE bot_account_id = ? AND scope_type = ? AND scope_key = ?')
        .get(accountId, scopeType, scopeKey)
    },
    ruleByScope({ accountId, scopeType, scopeKey }) {
      return db
        .prepare('SELECT * FROM qq_access_rules WHERE bot_account_id = ? AND scope_type = ? AND scope_key = ?')
        .get(accountId, scopeType, scopeKey)
    },
  }
}
import { randomUUID } from 'node:crypto'
