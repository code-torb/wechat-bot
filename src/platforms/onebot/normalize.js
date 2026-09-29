import { oneBotId } from './ids.js'

export function normalizeOneBotEvent({ event, identity, botAccountId }) {
  if (!event || event.post_type !== 'message' || event.anonymous) return null
  const selfId = oneBotId(event.self_id)
  const userId = oneBotId(event.user_id)
  const messageId = oneBotId(event.message_id, true)
  if (!selfId || !userId || messageId === null || !identity || selfId !== identity.selfId || userId === selfId) return null

  if (event.message_type === 'group') {
    const groupId = oneBotId(event.group_id)
    if (!groupId || !Array.isArray(event.message)) return null
    let mentionedSelf = false
    const parts = []
    for (const segment of event.message) {
      if (segment?.type === 'text' && typeof segment.data?.text === 'string') parts.push(segment.data.text)
      else if (segment?.type === 'at') {
        const target = oneBotId(segment.data?.qq)
        if (target === selfId) mentionedSelf = true
        else if (target) parts.push(`@${target}`)
        else if (segment.data?.qq === 'all') parts.push('@全体成员')
        else return null
      } else if (segment?.type !== 'reply') return null
    }
    return {
      platform: 'qq-onebot',
      botAccountId,
      selfId,
      scene: 'group',
      peerId: groupId,
      senderId: userId,
      messageId,
      text: parts.join('').trim(),
      mentionedSelf,
      privateSubtype: null,
      connectionGeneration: identity.generation,
      receivedAt: Date.now(),
    }
  }

  if (event.message_type === 'private') {
    if (!Array.isArray(event.message)) return null
    const parts = []
    for (const segment of event.message) {
      if (segment?.type === 'text' && typeof segment.data?.text === 'string') parts.push(segment.data.text)
      else if (segment?.type !== 'reply') return null
    }
    return {
      platform: 'qq-onebot',
      botAccountId,
      selfId,
      scene: 'private',
      peerId: userId,
      senderId: userId,
      messageId,
      text: parts.join('').trim(),
      mentionedSelf: false,
      privateSubtype: event.sub_type || 'other',
      connectionGeneration: identity.generation,
      receivedAt: Date.now(),
    }
  }

  return null
}
