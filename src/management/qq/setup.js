import { createHash } from 'node:crypto'
import { capabilityLevel } from '../permissions/policy.js'

export function serializeRule(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    allow: Boolean(row.allow),
    trigger: JSON.parse(row.trigger_json),
    maxLevel: row.max_level,
    pacingOverride: row.pacing_override_json ? JSON.parse(row.pacing_override_json) : null,
    quoteReply: Boolean(row.quote_reply),
  }
}

function setupError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), { code, exposeMessage: message, statusCode })
}

function validScope(type, key) {
  return (['group', 'private'].includes(type) && /^\d+$/.test(key)) || (type === 'group_user' && /^\d+:\d+$/.test(key))
}

export function createQQSetup({ db, qqRules, grants, service }) {
  function read(accountId) {
    const account = qqRules.account(accountId)
    if (!account || account.platform !== 'qq-onebot') throw setupError('NOT_FOUND', 'QQ 帐号不存在', 404)
    const rules = qqRules
      .rules(accountId)
      .map(serializeRule)
      .sort((a, b) => `${a.scopeType}:${a.scopeKey}`.localeCompare(`${b.scopeType}:${b.scopeKey}`))
    const bindings = qqRules
      .bindings(accountId)
      .map((row) => ({ scopeType: row.scope_type, scopeKey: row.scope_key, agentId: row.agent_id }))
      .sort((a, b) => `${a.scopeType}:${a.scopeKey}`.localeCompare(`${b.scopeType}:${b.scopeKey}`))
    const principalGrants = grants
      .list({ botAccountId: accountId })
      .map((row) => ({ scene: row.scene, peerId: row.peer_id, senderId: row.sender_id, capability: row.capability, resourceId: row.resource_id }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const data = { accountId, selfId: account.self_id, defaultAgentId: account.default_agent_id, rules, bindings, grants: principalGrants }
    return { ...data, revision: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
  }

  function validate({ defaultAgentId, rules, bindings, grants: principalGrants }) {
    if (typeof defaultAgentId !== 'string' || !defaultAgentId) throw setupError('VALIDATION', '请选择默认 Agent')
    function activeAgent(id) {
      return service.get(id)?.status === 'active' && Boolean(service.getPublished(id))
    }
    if (!activeAgent(defaultAgentId)) throw setupError('VALIDATION', '默认 Agent 必须已发布并启用')
    if (
      !Array.isArray(rules) ||
      rules.length > 200 ||
      !Array.isArray(bindings) ||
      bindings.length > 200 ||
      !Array.isArray(principalGrants) ||
      principalGrants.length > 500
    ) {
      throw setupError('VALIDATION', '白名单、绑定或授权数量超出限制')
    }
    const ruleKeys = new Set()
    for (const rule of rules) {
      if (
        !validScope(rule.scopeType, rule.scopeKey) ||
        typeof rule.allow !== 'boolean' ||
        !Number.isInteger(rule.maxLevel) ||
        rule.maxLevel < 0 ||
        rule.maxLevel > 3
      ) {
        throw setupError('VALIDATION', '白名单场景、帐号或权限级别无效')
      }
      const key = `${rule.scopeType}:${rule.scopeKey}`
      if (ruleKeys.has(key)) throw setupError('VALIDATION', '白名单存在重复的群号或 QQ 号')
      ruleKeys.add(key)
      if (rule.scopeType === 'group' && rule.allow && !rule.trigger?.mention && !rule.trigger?.prefix && !rule.trigger?.phrase) {
        throw setupError('VALIDATION', '群聊至少设置一种触发方式')
      }
    }
    const bindingKeys = new Set()
    for (const binding of bindings) {
      if (!validScope(binding.scopeType, binding.scopeKey) || !activeAgent(binding.agentId)) {
        throw setupError('VALIDATION', '单独绑定的帐号或 Agent 无效')
      }
      const key = `${binding.scopeType}:${binding.scopeKey}`
      if (bindingKeys.has(key)) throw setupError('VALIDATION', 'Agent 绑定重复')
      bindingKeys.add(key)
    }
    const grantKeys = new Set()
    for (const grant of principalGrants) {
      if (
        !['group', 'private'].includes(grant.scene) ||
        !/^\d+$/.test(grant.peerId) ||
        !/^\d+$/.test(grant.senderId) ||
        capabilityLevel(grant.capability) < 1 ||
        (grant.scene === 'private' && grant.peerId !== grant.senderId) ||
        (grant.capability.startsWith('files.') && !grant.resourceId)
      ) {
        throw setupError('VALIDATION', '工具授权需要有效的场景、发言者、能力和文件资源')
      }
      const key = JSON.stringify(grant)
      if (grantKeys.has(key)) throw setupError('VALIDATION', '工具授权重复')
      grantKeys.add(key)
    }
  }

  return {
    read,
    save({ accountId, revision, defaultAgentId, rules, bindings, grants: principalGrants }) {
      validate({ defaultAgentId, rules, bindings, grants: principalGrants })
      db.transaction(() => {
        if (read(accountId).revision !== revision) throw setupError('CONFLICT', '配置已被其他操作修改，请刷新后重试', 409)
        qqRules.setDefaultAgent(accountId, defaultAgentId)
        db.prepare('DELETE FROM qq_access_rules WHERE bot_account_id = ?').run(accountId)
        for (const rule of rules) {
          qqRules.upsertRule({
            accountId,
            scopeType: rule.scopeType,
            scopeKey: rule.scopeKey,
            allow: rule.allow,
            trigger: rule.trigger || {},
            maxLevel: rule.maxLevel,
            pacingOverride: rule.pacingOverride || null,
            quoteReply: Boolean(rule.quoteReply),
          })
        }
        db.prepare('DELETE FROM agent_bindings WHERE bot_account_id = ?').run(accountId)
        for (const binding of bindings) {
          qqRules.upsertBinding({ accountId, ...binding })
        }
        db.prepare('DELETE FROM principal_grants WHERE bot_account_id = ?').run(accountId)
        for (const grant of principalGrants) {
          grants.upsert({ botAccountId: accountId, ...grant })
        }
      })()
      return read(accountId)
    },
  }
}
