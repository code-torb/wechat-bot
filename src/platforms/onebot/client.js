import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { oneBotId } from './ids.js'

export function createOneBotClient({
  url,
  accessToken,
  expectedSelfId = '',
  requestTimeoutMs = 10000,
  reconnectMs = 3000,
  heartbeatMs = 15000,
  maxPending = 64,
}) {
  const client = new EventEmitter()
  const pending = new Map()
  let socket,
    identity = null,
    generation = 0,
    retryTimer,
    heartbeatTimer,
    failures = 0
  let stopped = true
  Object.defineProperty(client, 'identity', { get: () => identity })

  function rejectPending() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('OneBot disconnected; action was not retried'))
    }
    pending.clear()
  }

  function request(action, params, ws, epoch) {
    if (stopped || ws !== socket || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('OneBot not connected'))
    if (pending.size >= maxPending) return Promise.reject(new Error('OneBot request capacity exceeded'))
    const echo = `${epoch}:${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(echo)
        reject(new Error('OneBot action timeout; delivery is unknown and was not retried'))
      }, requestTimeoutMs)
      pending.set(echo, { resolve, reject, timer })
      ws.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return
        const entry = pending.get(echo)
        if (entry) {
          clearTimeout(entry.timer)
          pending.delete(echo)
          reject(new Error('OneBot send failed; action was not retried'))
        }
      })
    })
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return
    const delay = Math.min(reconnectMs * 2 ** Math.min(failures++, 5), 30000)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
  }

  function connect() {
    if (stopped) return
    const epoch = ++generation
    let ws
    try {
      ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        handshakeTimeout: requestTimeoutMs,
        maxPayload: 1024 * 1024,
        followRedirects: false,
      })
    } catch {
      client.emit('status', 'connection_error')
      scheduleReconnect()
      return
    }
    socket = ws
    let alive = true
    ws.on('pong', () => {
      alive = true
    })
    ws.on('open', async () => {
      heartbeatTimer = setInterval(() => {
        if (!alive) {
          ws.terminate()
          return
        }
        alive = false
        ws.ping()
      }, heartbeatMs)
      try {
        const info = await request('get_login_info', {}, ws, epoch)
        if (stopped || socket !== ws || ws.readyState !== WebSocket.OPEN) return
        const selfId = oneBotId(info?.user_id)
        if (!selfId || (expectedSelfId && selfId !== expectedSelfId)) throw new Error('wrong login')
        identity = Object.freeze({ selfId, generation: epoch })
        failures = 0
        client.emit('ready', identity)
      } catch {
        client.emit('status', 'login_failed')
        ws.terminate()
      }
    })
    ws.on('message', (raw, isBinary) => {
      if (stopped || socket !== ws || isBinary) return
      let payload
      try {
        payload = JSON.parse(raw.toString())
      } catch {
        client.emit('status', 'invalid_payload')
        return
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
      const entry = pending.get(payload.echo)
      if (entry) {
        pending.delete(payload.echo)
        clearTimeout(entry.timer)
        if (payload.status === 'ok' && payload.retcode === 0) entry.resolve(payload.data)
        else {
          const code = Number.isSafeInteger(payload.retcode) ? payload.retcode : 'unknown'
          entry.reject(new Error(`OneBot action failed, retcode ${code}`))
        }
      } else if (identity && payload.post_type) client.emit('event', payload, identity)
    })
    ws.on('error', () => {
      client.emit('status', 'connection_error')
    })
    ws.on('close', () => {
      if (socket !== ws) return
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
      identity = null
      rejectPending()
      client.emit('disconnected')
      scheduleReconnect()
    })
  }

  client.start = () => {
    if (stopped) {
      stopped = false
      connect()
    }
  }
  client.call = (action, params = {}, options = {}) => {
    if (!identity || stopped) return Promise.reject(new Error('OneBot not connected'))
    if (options.generation !== undefined && options.generation !== identity.generation)
      return Promise.reject(new Error('OneBot stale connection; reply discarded'))
    return request(action, params, socket, identity.generation)
  }
  client.stop = async () => {
    stopped = true
    identity = null
    clearTimeout(retryTimer)
    retryTimer = undefined
    clearInterval(heartbeatTimer)
    rejectPending()
    const ws = socket
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise((resolve) => {
        ws.once('close', resolve)
        ws.terminate()
      })
    }
  }
  return client
}
