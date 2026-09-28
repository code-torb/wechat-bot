import { createQQSigner } from './signature.js'

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

function normalize(payload, appId) {
  if (payload.op !== 0 || payload.t !== 'GROUP_AT_MESSAGE_CREATE') return null
  const d = payload.d
  if (!d || d.author?.bot || (d.message_type !== undefined && d.message_type !== 0)) return null
  if (![d.id, d.group_openid, d.author?.member_openid].every((v) => typeof v === 'string' && v.trim())) return null
  if (typeof d.content !== 'string' || d.attachments?.length) return null
  // QQ already removes the bot's @ prefix. Other user mentions remain intact.
  return { platform: 'qq-official', botId: appId, groupId: d.group_openid, userId: d.author.member_openid, messageId: d.id, text: d.content.trim() }
}

export function createQQWebhook({
  appId,
  appSecret,
  handleMessage,
  sendReply,
  path = '/webhook/qq',
  groupAllowlist = [],
  maxBodyBytes = 65536,
  maxPending = 32,
  maxDedupEntries = 10000,
  dedupTtlMs = 600000,
  signatureMaxAgeMs = 300000,
  now = Date.now,
  onError = () => console.error('QQ message processing or reply failed'),
}) {
  const signer = createQQSigner(appSecret)
  const allowed = new Set(groupAllowlist)
  const seen = new Map(),
    pending = new Set()
  let closing = false

  function prune() {
    for (const [key, entry] of seen) {
      if (!entry.active && entry.expires <= now()) seen.delete(key)
    }
    if (seen.size >= maxDedupEntries) {
      for (const [key, entry] of seen) {
        if (!entry.active) {
          seen.delete(key)
          break
        }
      }
    }
  }

  async function receive(request, response) {
    if (request.url === '/healthz' && request.method === 'GET') {
      reply(response, closing ? 503 : 200, { status: closing ? 'stopping' : 'ok' })
      return
    }
    if (request.url !== path) {
      reply(response, 404, { error: 'not_found' })
      return
    }
    if (request.method !== 'POST') {
      reply(response, 405, { error: 'method_not_allowed' })
      return
    }
    if (closing) {
      reply(response, 503, { error: 'stopping' })
      return
    }
    if (request.headers['x-bot-appid'] !== appId) {
      reply(response, 401, { error: 'invalid_app' })
      return
    }

    const chunks = []
    let size = 0,
      oversized = false
    for await (const chunk of request) {
      size += chunk.length
      if (size > maxBodyBytes) {
        if (!oversized) {
          reply(response, 413, { error: 'body_too_large' })
          oversized = true
          chunks.length = 0
        }
      } else if (!oversized) chunks.push(chunk)
    }
    if (oversized) return
    // close() may run while this request is still streaming its body.
    if (closing) {
      reply(response, 503, { error: 'stopping' })
      return
    }
    const raw = Buffer.concat(chunks)
    let payload
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      reply(response, 400, { error: 'invalid_json' })
      return
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      reply(response, 400, { error: 'invalid_payload' })
      return
    }

    // The official op 13 example has only X-Bot-Appid, without signature headers.
    const signature = request.headers['x-signature-ed25519']
    const timestamp = request.headers['x-signature-timestamp']
    if (payload.op !== 13 || signature || timestamp) {
      if (!signer.verify(timestamp, raw, signature) || Math.abs(now() - Number(timestamp) * 1000) > signatureMaxAgeMs) {
        reply(response, 401, { error: 'invalid_signature' })
        return
      }
    }
    if (payload.op === 13) {
      const { plain_token: token, event_ts: eventTs } = payload.d || {}
      // The unsigned registration flow must never sign arbitrary event JSON.
      // Accept only opaque token characters, keeping it disjoint from JSON bodies.
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(token) || typeof eventTs !== 'string' || !/^\d{1,16}$/.test(eventTs)) {
        reply(response, 400, { error: 'invalid_challenge' })
        return
      }
      reply(response, 200, { plain_token: token, signature: signer.sign(eventTs, token) })
      return
    }

    const message = normalize(payload, appId)
    if (!message || (allowed.size && !allowed.has(message.groupId))) {
      reply(response, 200, { op: 12 })
      return
    }
    const key = JSON.stringify([message.groupId, message.messageId])
    const old = seen.get(key)
    if (old && (old.active || old.expires > now())) {
      reply(response, 200, { op: 12 })
      return
    }
    if (pending.size >= maxPending) {
      reply(response, 503, { error: 'busy' })
      return
    }
    prune()
    if (seen.size >= maxDedupEntries) {
      reply(response, 503, { error: 'busy' })
      return
    }
    const entry = { active: true, expires: now() + dedupTtlMs }
    seen.set(key, entry)
    reply(response, 200, { op: 12 })

    // Start after ending the callback response; never wait for AI before ACK.
    const job = new Promise((resolve) => setImmediate(resolve))
      .then(() => handleMessage(message))
      .then((text) => {
        if (text) return sendReply(message, text)
      })
      .catch((error) => {
        onError(error)
      })
      .finally(() => {
        entry.active = false
        entry.expires = now() + dedupTtlMs
        pending.delete(job)
      })
    pending.add(job)
  }

  const handler = (request, response) => {
    receive(request, response).catch(() => {
      if (!response.headersSent && !response.destroyed) reply(response, 400, { error: 'invalid_request' })
    })
  }
  handler.close = () => {
    closing = true
  }
  handler.drain = async () => {
    while (pending.size) await Promise.allSettled([...pending])
  }
  return handler
}
