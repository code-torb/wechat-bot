import { configValue, getChatConfig, integerConfig, urlConfig } from '../../chat/config.js'

export function getQQConfig(env = {}) {
  const appId = configValue(env, 'QQ_APP_ID')
  const appSecret = configValue(env, 'QQ_APP_SECRET')
  const apiKey = configValue(env, 'CHAT_API_KEY', env.OPENAI_API_KEY)
  const model = configValue(env, 'CHAT_MODEL', env.OPENAI_MODEL)
  const missing = [!appId && 'QQ_APP_ID', !appSecret && 'QQ_APP_SECRET', !apiKey && 'CHAT_API_KEY', !model && 'CHAT_MODEL'].filter(Boolean)
  if (missing.length) throw new Error(`请先配置 .env：${missing.join('、')}`)

  const path = configValue(env, 'QQ_WEBHOOK_PATH', '/webhook/qq')
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path === '/healthz') throw new Error('QQ_WEBHOOK_PATH 必须是独立的 URL 路径，不能是 /healthz')

  const chat = getChatConfig(env)

  return {
    qq: {
      appId,
      appSecret,
      apiBaseURL: urlConfig(env, 'QQ_API_BASE_URL', 'https://api.bot.qq.com'),
      tokenURL: 'https://api.bot.qq.com/app/getAppAccessToken',
      timeoutMs: 10000,
    },
    server: { host: configValue(env, 'QQ_WEBHOOK_HOST', '127.0.0.1'), port: integerConfig(env, 'QQ_WEBHOOK_PORT', 3001, 1, 65535) },
    webhook: {
      path,
      groupAllowlist: configValue(env, 'QQ_GROUP_ALLOWLIST')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      maxPending: integerConfig(env, 'QQ_MAX_PENDING', 32, 1, 1000),
    },
    provider: chat.provider,
    core: chat.core,
  }
}
