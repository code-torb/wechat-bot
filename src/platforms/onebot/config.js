import { getChatConfig } from '../../chat/config.js'
import { oneBotId } from './ids.js'

export function getOneBotConfig(env) {
  const text = (key, fallback = '') => String(env[key] || fallback).trim()
  const token = text('ONEBOT_ACCESS_TOKEN'),
    groups = text('ONEBOT_GROUP_ALLOWLIST')
  const missing = [!token && 'ONEBOT_ACCESS_TOKEN', !groups && 'ONEBOT_GROUP_ALLOWLIST'].filter(Boolean)
  if (missing.length) throw new Error(`请先配置 .env：${missing.join('、')}`)
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error('ONEBOT_ACCESS_TOKEN 只能包含非空格的可打印 ASCII 字符')
  const groupAllowlist = groups
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => oneBotId(id))
  if (!groupAllowlist.length || groupAllowlist.some((id) => !id)) throw new Error('ONEBOT_GROUP_ALLOWLIST 必须填写逗号分隔的数字 QQ 群号')
  const expected = text('ONEBOT_SELF_ID')
  const expectedSelfId = expected ? oneBotId(expected) : ''
  if (expected && !expectedSelfId) throw new Error('ONEBOT_SELF_ID 必须为数字 QQ 号')
  let url
  try {
    url = new URL(text('ONEBOT_WS_URL', 'ws://127.0.0.1:3001'))
  } catch {
    throw new Error('ONEBOT_WS_URL 必须是有效 WebSocket URL')
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /^\/(api|event)\/?$/.test(url.pathname)) {
    throw new Error('ONEBOT_WS_URL 需使用 ws/wss 双向服务根路径，不能带凭证、查询参数或使用 /api、/event')
  }
  const integer = (key, fallback, min, max) => {
    const n = Number(text(key, fallback))
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} 必须是 ${min}–${max} 之间的整数`)
    return n
  }
  return {
    ...getChatConfig(env),
    client: {
      url: url.toString(),
      accessToken: token,
      expectedSelfId,
      requestTimeoutMs: integer('ONEBOT_REQUEST_TIMEOUT_MS', 10000, 100, 60000),
      reconnectMs: integer('ONEBOT_RECONNECT_MS', 3000, 100, 30000),
      heartbeatMs: 15000,
      maxPending: 64,
    },
    messages: { groupAllowlist: [...new Set(groupAllowlist)], maxPending: integer('ONEBOT_MAX_PENDING', 32, 1, 64) },
  }
}
