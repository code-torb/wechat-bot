import { oneBotId } from './ids.js'

export function normalizeGroupMessage(event, identity, groupAllowlist) {
  if (!event || event.post_type !== 'message' || event.message_type !== 'group') return null
  if (event.anonymous || (event.sub_type && event.sub_type !== 'normal')) return null
  const botId = oneBotId(event.self_id),
    userId = oneBotId(event.user_id)
  const groupId = oneBotId(event.group_id),
    messageId = oneBotId(event.message_id, true)
  if (!botId || !userId || !groupId || messageId === null || botId !== identity?.selfId || userId === botId) return null
  const allowed = groupAllowlist instanceof Set ? groupAllowlist : new Set(groupAllowlist)
  if (!allowed.has(groupId) || !Array.isArray(event.message)) return null
  let mentioned = false
  const parts = []
  for (const segment of event.message) {
    if (segment?.type === 'text' && typeof segment.data?.text === 'string') parts.push(segment.data.text)
    else if (segment?.type === 'at') {
      const target = oneBotId(segment.data?.qq)
      if (target === botId) mentioned = true
      else if (target) parts.push(`@${target}`)
      else if (segment.data?.qq === 'all') parts.push('@全体成员')
      else return null
    } else if (segment?.type !== 'reply') return null
  }
  return mentioned ? { platform: 'qq-onebot', botId, groupId, userId, messageId, text: parts.join('').trim() } : null
}

function normalizePrivateMessage(event, identity, allowed) {
  if (!event || event.post_type !== 'message' || event.message_type !== 'private' || event.sub_type !== 'friend' || event.anonymous) return null
  const botId = oneBotId(event.self_id),
    userId = oneBotId(event.user_id),
    messageId = oneBotId(event.message_id, true)
  if (!botId || !userId || messageId === null || botId !== identity?.selfId || userId === botId) return null
  if (!allowed.has(userId) || !Array.isArray(event.message)) return null
  const parts = []
  for (const segment of event.message) {
    if (segment?.type === 'text' && typeof segment.data?.text === 'string') parts.push(segment.data.text)
    else if (segment?.type !== 'reply') return null
  }
  // The shared core keys sessions by groupId + userId. This namespace cannot collide with a numeric QQ group ID.
  return { platform: 'qq-onebot', botId, groupId: `private:${userId}`, userId, messageId, messageType: 'private', text: parts.join('').trim() }
}

export function groupReplyParams(message, text, quote = false) {
  return {
    group_id: Number(message.groupId),
    message: [...(quote ? [{ type: 'reply', data: { id: message.messageId } }] : []), { type: 'text', data: { text } }],
  }
}

export function privateReplyParams(message, text) {
  return { user_id: Number(message.userId), message: [{ type: 'text', data: { text } }] }
}

export function createOneBotMessageHandler({
  groupAllowlist = [],
  privateEnabled = false,
  privateAllowlist = [],
  handleMessage,
  sendReply,
  maxPending = 32,
  maxDedupEntries = 10000,
  dedupTtlMs = 600000,
  now = Date.now,
  onError = () => {},
}) {
  const allowed = new Set(groupAllowlist),
    privateAllowed = new Set(privateAllowlist),
    seen = new Map(),
    pending = new Set()
  let closing = false
  return {
    accept(event, identity) {
      if (closing) return false
      const message =
        normalizeGroupMessage(event, identity, allowed) || (privateEnabled ? normalizePrivateMessage(event, identity, privateAllowed) : null)
      if (!message) return false
      const key = JSON.stringify([message.botId, message.groupId, message.messageId])
      const old = seen.get(key)
      if (old && (old.active || old.expires > now())) return false
      if (pending.size >= maxPending) return false
      for (const [id, entry] of seen) if (!entry.active && entry.expires <= now()) seen.delete(id)
      if (seen.size >= maxDedupEntries) {
        for (const [id, entry] of seen)
          if (!entry.active) {
            seen.delete(id)
            break
          }
      }
      if (seen.size >= maxDedupEntries) return false
      const entry = { active: true, expires: now() + dedupTtlMs }
      seen.set(key, entry)
      const origin = { ...identity }
      const task = Promise.resolve()
        .then(() => handleMessage(message))
        .then((text) => {
          if (text) return sendReply(message, text, origin)
        })
        .catch(() => {
          try {
            onError()
          } catch {
            /* Diagnostics must not create unhandled rejections. */
          }
        })
        .finally(() => {
          entry.active = false
          entry.expires = now() + dedupTtlMs
          pending.delete(task)
        })
      pending.add(task)
      return true
    },
    close() {
      closing = true
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending])
    },
  }
}
