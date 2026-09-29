import { createQQRuleRepository } from './rules.js'

function parseTrigger(trigger) {
  const base = { mode: 'any', mention: false, prefix: null, phrase: null }
  if (!trigger || typeof trigger !== 'object') return base
  return {
    mode: trigger.mode === 'all' ? 'all' : 'any',
    mention: Boolean(trigger.mention),
    prefix: typeof trigger.prefix === 'string' && trigger.prefix.length ? trigger.prefix : null,
    phrase: typeof trigger.phrase === 'string' && trigger.phrase.length ? trigger.phrase : null,
  }
}

function startsWithBoundary(text, prefix) {
  if (!prefix) return false
  return text.startsWith(prefix) && (text.length === prefix.length || /\s/.test(text[prefix.length]) || text[prefix.length] === '@')
}

function triggerHit(message, trigger) {
  const mentionHit = trigger.mention && message.mentionedSelf
  const prefixHit = trigger.prefix && startsWithBoundary(message.text, trigger.prefix)
  const phraseHit = trigger.phrase && message.text === trigger.phrase
  if (trigger.mode === 'all') {
    const mentionOk = !trigger.mention || message.mentionedSelf
    const prefixOk = !trigger.prefix || prefixHit
    const phraseOk = !trigger.phrase || phraseHit
    return mentionOk && prefixOk && phraseOk
  }
  return Boolean(mentionHit || prefixHit || phraseHit)
}

export function createQQRouter({ db, service }) {
  const rules = createQQRuleRepository(db)

  function resolveAgentId(bot, message) {
    if (message.scene === 'group') {
      const userBinding = rules.bindingByScope({
        accountId: bot.id,
        scopeType: 'group_user',
        scopeKey: `${message.peerId}:${message.senderId}`,
      })
      if (userBinding) return userBinding.agent_id
      const groupBinding = rules.bindingByScope({ accountId: bot.id, scopeType: 'group', scopeKey: message.peerId })
      if (groupBinding) return groupBinding.agent_id
      return bot.default_agent_id
    }
    const privateBinding = rules.bindingByScope({ accountId: bot.id, scopeType: 'private', scopeKey: message.peerId })
    return privateBinding?.agent_id || bot.default_agent_id
  }

  return {
    resolve(message) {
      const bot = rules.account(message.botAccountId)
      if (!bot || !bot.enabled) return { accepted: false, reason: 'bot_account_disabled' }
      if (message.scene === 'private' && message.privateSubtype !== 'friend') {
        return { accepted: false, reason: 'private_not_friend' }
      }
      const scopeType = message.scene === 'group' ? 'group' : 'private'
      const rule = rules.ruleByScope({ accountId: bot.id, scopeType, scopeKey: message.peerId })
      if (!rule || !rule.allow) return { accepted: false, reason: 'not_allowlisted' }
      if (message.scene === 'group') {
        const trigger = parseTrigger(JSON.parse(rule.trigger_json))
        if (!triggerHit(message, trigger)) return { accepted: false, reason: 'trigger_not_matched' }
      }
      const agentId = resolveAgentId(bot, message)
      if (!agentId) return { accepted: false, reason: 'no_agent_bound' }
      const agent = service.get(agentId)
      if (!agent) return { accepted: false, reason: 'agent_unavailable' }
      const published = service.getPublished(agentId)
      if (!published) return { accepted: false, reason: 'agent_not_published' }
      if (agent.status !== 'active') return { accepted: false, reason: 'agent_unavailable' }
      const pacing = rule.pacing_override_json ? JSON.parse(rule.pacing_override_json) : published.pacing
      return {
        accepted: true,
        reason: 'ok',
        agentId,
        agentVersion: published,
        maxLevel: rule.max_level,
        pacing,
        quoteReply: Boolean(rule.quote_reply),
        triggerSource: rule.scope_key,
      }
    },
    preview({ botAccountId, scene, peerId, senderId, text, mentionedSelf, privateSubtype = 'friend' }) {
      return this.resolve({
        platform: 'qq-onebot',
        botAccountId,
        selfId: '',
        scene,
        peerId,
        senderId,
        messageId: 'preview',
        text,
        mentionedSelf,
        privateSubtype,
        connectionGeneration: 0,
        receivedAt: Date.now(),
      })
    },
  }
}
