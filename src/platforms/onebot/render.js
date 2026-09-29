export function renderReply({ message, reply, quote, readAsset }) {
  const segments = []
  if (quote) segments.push({ type: 'reply', data: { id: message.messageId } })
  segments.push({ type: 'text', data: { text: reply.text } })
  for (const assetId of reply.assetIds || []) {
    const asset = readAsset ? readAsset({ assetId }) : null
    if (asset) segments.push({ type: 'image', data: { file: `base64://${asset.buffer.toString('base64')}`, subType: 'normal' } })
  }
  return {
    action: message.scene === 'private' ? 'send_private_msg' : 'send_group_msg',
    params: {
      [message.scene === 'private' ? 'user_id' : 'group_id']: Number(message.peerId),
      message: segments,
    },
  }
}
