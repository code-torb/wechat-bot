import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { createOneBotClient } from './client.js'

async function fixture(t, handle, options = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, ...options.serverOptions })
  await once(server, 'listening')
  const requests = [],
    sockets = []
  server.on('connection', (socket, request) => {
    sockets.push(socket)
    requests.push(request)
    socket.on('message', (raw) => {
      const call = JSON.parse(raw)
      if (call.action === 'get_login_info') socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 12345 }, echo: call.echo }))
      else handle?.(socket, call)
    })
  })
  const client = createOneBotClient({
    url: `ws://127.0.0.1:${server.address().port}`,
    accessToken: 'secret',
    reconnectMs: 20,
    requestTimeoutMs: 100,
    heartbeatMs: 5000,
    ...options,
  })
  t.after(async () => {
    await client.stop()
    for (const socket of server.clients) socket.terminate()
    await new Promise((resolve) => server.close(resolve))
  })
  const ready = options.waitForReady === false ? null : once(client, 'ready')
  client.start()
  if (ready) await ready
  return { client, server, requests, sockets }
}

test('authenticates with Bearer header, gets identity, correlates out-of-order RPC responses', async (t) => {
  const calls = []
  const f = await fixture(t, (socket, call) => {
    calls.push(call)
    if (calls.length === 2)
      for (const c of [...calls].reverse()) socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: c.params, echo: c.echo }))
  })
  assert.equal(f.requests[0].headers.authorization, 'Bearer secret')
  assert.equal(f.requests[0].url, '/')
  assert.equal(f.client.identity.selfId, '12345')
  const result = await Promise.all([f.client.call('test', { n: 1 }), f.client.call('test', { n: 2 })])
  assert.deepEqual(result, [{ n: 1 }, { n: 2 }])
})

test('times out requests, bounds pending RPC and sanitizes failed remote responses', async (t) => {
  let requestCount = 0
  const f = await fixture(
    t,
    (socket, call) => {
      requestCount++
      if (call.action === 'fail') socket.send(JSON.stringify({ status: 'failed', retcode: 1200, wording: 'secret upstream', echo: call.echo }))
    },
    { maxPending: 1 },
  )
  const pending = f.client.call('wait', {})
  const rejection = assert.rejects(pending, /timeout/i)
  await assert.rejects(f.client.call('overflow', {}), /capacity/i)
  await rejection
  await assert.rejects(f.client.call('fail', {}), (e) => /1200/.test(e.message) && !e.message.includes('secret upstream'))
  assert.equal(requestCount, 2)
})

test('disconnect rejects pending actions, reconnects and rejects stale generation sends', async (t) => {
  const f = await fixture(t)
  const oldGeneration = f.client.identity.generation
  const pending = f.client.call('waiting', {})
  const rejected = assert.rejects(pending, /disconnect/i)
  const ready = once(f.client, 'ready')
  f.sockets[0].terminate()
  await rejected
  await ready
  assert.ok(f.client.identity.generation > oldGeneration)
  await assert.rejects(f.client.call('send_group_msg', {}, { generation: oldGeneration }), /stale/i)
  assert.equal(f.sockets.length, 2)
})

test('only passes events after login and stop rejects calls without scheduling reconnect', async (t) => {
  const f = await fixture(t)
  const event = once(f.client, 'event')
  f.sockets[0].send(JSON.stringify({ post_type: 'message', self_id: 12345 }))
  const [payload, origin] = await event
  assert.equal(payload.self_id, 12345)
  assert.equal(origin.selfId, '12345')
  await f.client.stop()
  await assert.rejects(f.client.call('test', {}), /not connected/i)
  assert.equal(f.client.identity, null)
})

test('missing heartbeat pong disconnects the connection instead of keeping stale identity', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, null, { heartbeatMs: 20, reconnectMs: 1000, serverOptions: { autoPong: false } })
  await once(f.client, 'disconnected')
  assert.equal(f.client.identity, null)
  await assert.rejects(f.client.call('send_group_msg', {}), /not connected/i)
})

test('configured login identity mismatch never becomes ready or accepts API calls', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, null, { expectedSelfId: '54321', waitForReady: false, reconnectMs: 1000 })
  let readyCount = 0
  f.client.on('ready', () => {
    readyCount++
  })
  const [status] = await once(f.client, 'status')
  assert.equal(status, 'login_failed')
  assert.equal(f.client.identity, null)
  assert.equal(readyCount, 0)
  await assert.rejects(f.client.call('send_group_msg', {}), /not connected/i)
})
