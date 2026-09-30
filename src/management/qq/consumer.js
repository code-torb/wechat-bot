import { normalizeOneBotEvent } from '../../platforms/onebot/normalize.js'

export function createOneBotConsumer({ client, botAccountId, resolveBotAccountId, runtime, logger = console }) {
  client.on('event', (event, identity) => {
    const message = normalizeOneBotEvent({ event, identity, botAccountId: resolveBotAccountId?.(identity.selfId) || botAccountId })
    if (!message) return
    runtime.accept(message).then((result) => {
      if (result.status === 'limited') logger.warn('QQ 消息队列已满，忽略一条消息')
    })
  })
  return { botAccountId }
}
