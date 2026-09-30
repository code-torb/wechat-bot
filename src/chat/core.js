const DEFAULT_SYSTEM_PROMPT = '你是一个友好、简洁的中文聊天助手。'
const HELP_REPLY = '用法：直接发送消息开始聊天；发送 /new 开启一轮新的对话；发送 /reset 清除上下文；发送 /help 查看帮助。'
const RESET_REPLY = '已重置这段对话。'
const NEW_CHAT_REPLY = '好的，已开启一轮新的对话。'
const SESSION_BUSY_REPLY = '我正在回复你上一条消息，请稍等一下。'
const GLOBAL_BUSY_REPLY = '现在有点忙，请稍后再试。'
const COOLDOWN_REPLY = '你发送得太快了，请稍后再试。'
const TOO_LONG_REPLY = '消息太长了，请缩短后再发送。'
const ERROR_REPLY = '抱歉，我暂时没法回复，请稍后再试。'

function requireInteger(value, name, min) {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`${name} must be an integer greater than or equal to ${min}`)
  }
  return value
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isValidMessage(message) {
  return (
    message &&
    isNonEmptyString(message.platform) &&
    isNonEmptyString(message.botId) &&
    isNonEmptyString(message.groupId) &&
    isNonEmptyString(message.userId) &&
    isNonEmptyString(message.messageId) &&
    typeof message.text === 'string'
  )
}

function makeSession(time) {
  return {
    busy: false,
    history: [],
    lastAccessedAt: time,
    lastModelAt: null,
  }
}

function sessionKey(message) {
  return JSON.stringify([message.platform, message.botId, message.groupId, message.userId])
}

function clampReply(reply, maxReplyChars) {
  const text = typeof reply === 'string' ? reply.trim() : ''
  const characters = Array.from(text)
  return characters.length > maxReplyChars ? characters.slice(0, maxReplyChars).join('') : text
}

export function createChatCore({
  complete,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  maxTurns = 10,
  sessionTtlMs = 1800000,
  maxSessions = 1000,
  cooldownMs = 2000,
  maxConcurrent = 4,
  maxInputChars = 4000,
  maxReplyChars = 1500,
  now = Date.now,
} = {}) {
  if (typeof complete !== 'function') {
    throw new TypeError('complete must be a function')
  }
  if (!isNonEmptyString(systemPrompt)) {
    throw new TypeError('systemPrompt must be a nonempty string')
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function')
  }

  const historyLimit = requireInteger(maxTurns, 'maxTurns', 0) * 2
  const ttl = requireInteger(sessionTtlMs, 'sessionTtlMs', 0)
  const capacity = requireInteger(maxSessions, 'maxSessions', 1)
  const cooldown = requireInteger(cooldownMs, 'cooldownMs', 0)
  const concurrentLimit = requireInteger(maxConcurrent, 'maxConcurrent', 1)
  const inputLimit = requireInteger(maxInputChars, 'maxInputChars', 1)
  const replyLimit = requireInteger(maxReplyChars, 'maxReplyChars', 1)

  const sessions = new Map()
  let activeRequests = 0

  function evictInactiveSessionsUntil(targetSize) {
    const inactiveSessions = Array.from(sessions.entries())
      .filter(([, session]) => !session.busy)
      .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)

    for (const [key] of inactiveSessions) {
      if (sessions.size <= targetSize) return
      sessions.delete(key)
    }
  }

  function enforceCapacity() {
    if (sessions.size <= capacity) return
    evictInactiveSessionsUntil(capacity)
  }

  function hasRoomForNewSession() {
    if (sessions.size < capacity) return true
    evictInactiveSessionsUntil(capacity - 1)
    return sessions.size < capacity
  }

  function pruneSessions(time) {
    for (const [key, session] of sessions) {
      if (!session.busy && time - session.lastAccessedAt > ttl) {
        sessions.delete(key)
      }
    }
    enforceCapacity()
  }

  function trimHistory(session) {
    if (historyLimit === 0) {
      session.history = []
      return
    }

    if (session.history.length > historyLimit) {
      session.history.splice(0, session.history.length - historyLimit)
    }
  }

  async function handle(message) {
    if (!isValidMessage(message)) return null

    const startTime = now()
    pruneSessions(startTime)

    const key = sessionKey(message)
    let session = sessions.get(key)
    if (session) {
      session.lastAccessedAt = startTime
    }

    const text = message.text.trim()
    if (!text || text === '/help') {
      return HELP_REPLY
    }

    if (session?.busy) {
      return SESSION_BUSY_REPLY
    }

    if (text === '/reset') {
      sessions.delete(key)
      enforceCapacity()
      return RESET_REPLY
    }

    if (text === '/new' || text === '/newchat' || text === '/新对话' || text === '/开始新对话') {
      sessions.delete(key)
      enforceCapacity()
      return NEW_CHAT_REPLY
    }

    if (text.length > inputLimit) {
      return TOO_LONG_REPLY
    }

    if (session && cooldown > 0 && session.lastModelAt !== null && startTime - session.lastModelAt < cooldown) {
      return COOLDOWN_REPLY
    }

    if (activeRequests >= concurrentLimit) {
      return GLOBAL_BUSY_REPLY
    }

    if (!session) {
      if (!hasRoomForNewSession()) {
        return GLOBAL_BUSY_REPLY
      }
      session = makeSession(startTime)
      sessions.set(key, session)
    }

    session.busy = true
    activeRequests += 1

    const messages = [{ role: 'system', content: systemPrompt }, ...session.history, { role: 'user', content: text }]

    try {
      const reply = clampReply(await complete(messages), replyLimit)
      if (!reply) return ERROR_REPLY

      session.lastModelAt = startTime
      session.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
      trimHistory(session)
      return reply
    } catch {
      return ERROR_REPLY
    } finally {
      activeRequests -= 1
      session.busy = false
      session.lastAccessedAt = now()
      pruneSessions(session.lastAccessedAt)
    }
  }

  return { handle }
}
