import { env } from '../../config/env.js'
import { createChatCore } from '../../chat/core.js'
import { createChatProvider } from '../../chat/provider.js'
import { createOneBotClient } from './client.js'
import { getOneBotConfig } from './config.js'
import { createOneBotMessageHandler, groupReplyParams } from './messages.js'

export async function startOneBotAgent({ config = getOneBotConfig(env), complete, logger = console, installSignalHandlers = true } = {}) {
  const core = createChatCore({ ...config.core, complete: complete || createChatProvider(config.provider) })
  const client = createOneBotClient(config.client)
  const handler = createOneBotMessageHandler({
    ...config.messages,
    handleMessage: (message) => core.handle(message),
    sendReply: (message, text, origin) => client.call('send_group_msg', groupReplyParams(message, text), { generation: origin.generation }),
    onError: () => logger.error('QQ 回复未发送；连接可能已更换、已断开或 NapCat 拒绝发送。本条消息不会自动重发。'),
  })
  client.on('event', (event, identity) => handler.accept(event, identity))
  client.on('ready', () => logger.log('已连接 NapCat 并确认 QQ 登录；白名单群内 @当前账号即可对话。'))
  client.on('disconnected', () => logger.log('NapCat 连接已断开，运行期间将自动重连。'))
  client.on('status', (type) => {
    if (type === 'login_failed') logger.error('无法确认 NapCat 登录账号，请完成扫码登录并检查 ONEBOT_SELF_ID。')
    if (type === 'connection_error') logger.error('无法连接 NapCat，请检查正向 WebSocket 服务、地址和 ONEBOT_ACCESS_TOKEN。')
  })
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
    stopping = handler
      .drain()
      .then(() => client.stop())
      .then(() => {
        logger.log('普通 QQ 聊天服务已停止')
      })
    return stopping
  }
  if (installSignalHandlers) {
    process.once('SIGINT', signalStop)
    process.once('SIGTERM', signalStop)
  }
  logger.log('正在连接 NapCat / OneBot；模型和提示词使用 CHAT_* 配置。')
  client.start()
  return { client, handler, stop }
}
