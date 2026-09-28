import { createServer } from 'node:http'
import { once } from 'node:events'
import { env } from '../../config/env.js'
import { createChatCore } from '../../chat/core.js'
import { createChatProvider } from '../../chat/provider.js'
import { getQQConfig } from './config.js'
import { createQQApi } from './api.js'
import { createQQWebhook } from './webhook.js'

export async function startQQAgent({ config = getQQConfig(env), complete, api, logger = console, installSignalHandlers = true } = {}) {
  const core = createChatCore({ ...config.core, complete: complete || createChatProvider(config.provider) })
  const transport = api || createQQApi(config.qq)
  const handler = createQQWebhook({
    appId: config.qq.appId,
    appSecret: config.qq.appSecret,
    ...config.webhook,
    handleMessage: (message) => core.handle(message),
    sendReply: (message, text) => transport.sendReply(message, text),
    onError: () => logger.error('QQ 消息处理或发送失败；请检查模型服务、机器人权限、消息时效与平台频控。'),
  })
  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000 }, handler)
  server.listen(config.server.port, config.server.host)
  await once(server, 'listening')

  let stopping
  const signalStop = () => {
    stop().catch(() => {
      logger.error('QQ 服务关闭失败')
      process.exitCode = 1
    })
  }
  function stop() {
    if (stopping) return stopping
    handler.close()
    process.off('SIGINT', signalStop)
    process.off('SIGTERM', signalStop)
    stopping = Promise.all([handler.drain(), new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))]).then(
      () => {
        logger.log('QQ 服务已停止')
      },
    )
    return stopping
  }
  if (installSignalHandlers) {
    process.once('SIGINT', signalStop)
    process.once('SIGTERM', signalStop)
  }
  logger.log(`QQ 官方群聊机器人已启动：http://${config.server.host}:${server.address().port}${config.webhook.path}`)
  logger.log('请将公网 HTTPS 回调地址配置到 QQ 开放平台，并订阅 GROUP_AT_MESSAGE_CREATE。')
  return { server, handler, stop }
}
