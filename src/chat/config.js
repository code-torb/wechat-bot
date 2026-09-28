import { readFileSync } from 'node:fs'

export const DEFAULT_CHAT_SYSTEM_PROMPT = '你是一个友好、简洁的中文聊天助手。请用纯文本回答，避免过长的回复。'

export function configValue(env, key, fallback = '') {
  return String(env[key] || fallback).trim()
}

export function integerConfig(env, key, fallback, min, max) {
  const n = Number(configValue(env, key, fallback))
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} 必须是 ${min}–${max} 之间的整数`)
  return n
}

export function urlConfig(env, key, fallback, localAllowed = false) {
  const text = configValue(env, key, fallback)
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`${key} 必须是有效 URL`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (
    (parsed.protocol !== 'https:' && !(localAllowed && local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${key} 必须是 HTTPS URL（本机模型可使用 HTTP），不可包含凭证或查询参数`)
  }
  return text.replace(/\/$/, '')
}

export function getChatConfig(env = {}) {
  const apiKey = configValue(env, 'CHAT_API_KEY', env.OPENAI_API_KEY)
  const model = configValue(env, 'CHAT_MODEL', env.OPENAI_MODEL)
  const missing = [!apiKey && 'CHAT_API_KEY', !model && 'CHAT_MODEL'].filter(Boolean)
  if (missing.length) throw new Error(`请先配置 .env：${missing.join('、')}`)

  let systemPrompt = configValue(env, 'CHAT_SYSTEM_PROMPT', DEFAULT_CHAT_SYSTEM_PROMPT)
  const promptFile = configValue(env, 'CHAT_SYSTEM_PROMPT_FILE')
  if (promptFile) {
    try {
      systemPrompt = readFileSync(promptFile, 'utf8').trim()
    } catch {
      throw new Error('CHAT_SYSTEM_PROMPT_FILE 无法读取，请检查文件路径和权限')
    }
    if (!systemPrompt) throw new Error('CHAT_SYSTEM_PROMPT_FILE 不能为空')
  }
  if (systemPrompt.length > 32000) throw new Error('CHAT_SYSTEM_PROMPT / CHAT_SYSTEM_PROMPT_FILE 不能超过 32000 字符')

  return {
    provider: {
      apiKey,
      model,
      baseURL: urlConfig(env, 'CHAT_BASE_URL', env.OPENAI_PROXY_URL || 'https://api.openai.com/v1', true),
      timeoutMs: integerConfig(env, 'CHAT_TIMEOUT_MS', 45000, 100, 120000),
      maxTokens: integerConfig(env, 'CHAT_MAX_TOKENS', 1000, 1, 16000),
    },
    core: {
      systemPrompt,
      maxTurns: integerConfig(env, 'CHAT_MAX_TURNS', 10, 1, 50),
      sessionTtlMs: integerConfig(env, 'CHAT_SESSION_TTL_MS', 1800000, 1000, 86400000),
      maxSessions: integerConfig(env, 'CHAT_MAX_SESSIONS', 1000, 1, 10000),
      cooldownMs: integerConfig(env, 'CHAT_COOLDOWN_MS', 2000, 0, 60000),
      maxConcurrent: integerConfig(env, 'CHAT_MAX_CONCURRENT', 4, 1, 64),
      maxInputChars: integerConfig(env, 'CHAT_MAX_INPUT_CHARS', 4000, 1, 32000),
      maxReplyChars: integerConfig(env, 'CHAT_MAX_REPLY_CHARS', 1500, 50, 2000),
    },
  }
}
