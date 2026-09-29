export function renderReply({ message, reply, quote }) {
  const segments = []
  if (quote) segments.push({ type: 'reply', data: { id: message.messageId } })
  segments.push({ type: 'text', data: { text: reply.text } })
  return {
    action: message.scene === 'private' ? 'send_private_msg' : 'send_group_msg',
    params: {
      [message.scene === 'private' ? 'user_id' : 'group_id']: Number(message.peerId),
      message: segments,
    },
  }
}
