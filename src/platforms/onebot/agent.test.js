import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { startOneBotAgent } from './agent.js'
import { getOneBotConfig } from './config.js'

const event = (id, text) => ({
  post_type: 'message',
  message_type: 'group',
  sub_type: 'normal',
  self_id: 12345,
  group_id: 34567,
  user_id: 23456,
  message_id: id,
  message: [
    { type: 'at', data: { qq: '12345' } },
    { type: 'text', data: { text } },
  ],
})

async function fixture(t, complete) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const sends = [],
    sockets = []
  let onSend
  server.on('connection', (socket) => {
    sockets.push(socket)
    socket.on('message', (raw) => {
      const call = JSON.parse(raw)
      if (call.action === 'get_login_info') socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 12345 }, echo: call.echo }))
      else if (call.action === 'send_group_msg') {
        sends.push(call.params)
        socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 321 }, echo: call.echo }))
        onSend?.()
      }
    })
  })
  const config = getOneBotConfig({
    ONEBOT_WS_URL: `ws://127.0.0.1:${server.address().port}`,
    ONEBOT_ACCESS_TOKEN: 'secret',
    ONEBOT_GROUP_ALLOWLIST: '34567',
    CHAT_API_KEY: 'test',
    CHAT_MODEL: 'test',
    CHAT_COOLDOWN_MS: '0',
  })
  config.client.reconnectMs = 10
  const runtime = await startOneBotAgent({ config, complete, installSignalHandlers: false, logger: { log() {}, error() {} } })
  t.after(async () => {
    await runtime.stop()
    for (const s of server.clients) s.terminate()
    await new Promise((r) => server.close(r))
  })
  await once(runtime.client, 'ready')
  return {
    ...runtime,
    sends,
    sockets,
    async sendAndWait(e) {
      const sent = new Promise((resolve) => {
        onSend = resolve
      })
      sockets.at(-1).send(JSON.stringify(e))
      await sent
      await runtime.handler.drain()
    },
  }
}

test('full OneBot WS flow retains conversation and reset without official credentials', { timeout: 5000 }, async (t) => {
  const prompts = []
  const f = await fixture(t, async (messages) => {
    prompts.push(messages)
    return 'answer [CQ:at,qq=all]'
  })
  await f.sendAndWait(event(1, 'hello'))
  await f.sendAndWait(event(2, 'continue'))
  await f.sendAndWait(event(3, '/reset'))
  await f.sendAndWait(event(4, 'new chat'))
  assert.deepEqual(
    prompts.map((p) => p.length),
    [2, 4, 2],
  )
  assert.equal(f.sends[0].group_id, 34567)
  assert.equal(f.sends[0].message[1].type, 'text')
  assert.equal(f.sends[0].message[1].data.text, 'answer [CQ:at,qq=all]')
})

test('delayed model answer is discarded after disconnect/reconnect instead of sending through a new login', { timeout: 5000 }, async (t) => {
  let entered, release
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const delayed = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, async () => {
    entered()
    await delayed
    return 'old answer'
  })
  try {
    f.sockets[0].send(JSON.stringify(event(1, 'hello')))
    await started
    const ready = once(f.client, 'ready')
    f.sockets[0].terminate()
    await ready
  } finally {
    release()
  }
  await f.handler.drain()
  assert.equal(f.sends.length, 0)
})
