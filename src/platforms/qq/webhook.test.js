import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { createQQSigner } from './signature.js'
import { createQQWebhook } from './webhook.js'

const appId = '123',
  appSecret = 'test-secret'
const timestamp = String(Math.floor(Date.now() / 1000))
const signer = createQQSigner(appSecret)
const event = (id = 'm1', overrides = {}) => ({
  op: 0,
  t: 'GROUP_AT_MESSAGE_CREATE',
  id: `event-${id}`,
  d: {
    id,
    group_openid: 'g1',
    author: { member_openid: 'u1' },
    content: '  你好  ',
    ...overrides,
  },
})

async function fixture(t, options = {}) {
  const handled = [],
    sent = [],
    errors = []
  const handler = createQQWebhook({
    appId,
    appSecret,
    handleMessage: async (message) => {
      handled.push(message)
      return '你好呀'
    },
    sendReply: async (message, text) => {
      sent.push({ message, text })
    },
    onError: (error) => errors.push(error),
    ...options,
  })
  const server = createServer(handler).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    handler.close()
    await handler.drain()
    await new Promise((resolve) => server.close(resolve))
  })
  const url = `http://127.0.0.1:${server.address().port}`
  const post = async (body, headers = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    return fetch(`${url}/webhook/qq`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-appid': appId,
        'x-signature-timestamp': timestamp,
        'x-signature-ed25519': signer.sign(timestamp, raw),
        ...headers,
      },
      body: raw,
    })
  }
  return { handler, handled, sent, errors, post, url }
}

test('unsigned official challenge is answered; health and paths do not call AI', async (t) => {
  const f = await fixture(t)
  const r = await f.post({ op: 13, d: { plain_token: 'token', event_ts: timestamp } }, { 'x-signature-ed25519': '', 'x-signature-timestamp': '' })
  assert.deepEqual(await r.json(), { plain_token: 'token', signature: signer.sign(timestamp, 'token') })
  assert.equal((await fetch(`${f.url}/healthz`)).status, 200)
  assert.equal((await fetch(`${f.url}/missing`)).status, 404)
  assert.equal(f.handled.length, 0)
})

test('rejects unsigned, stale, tampered, malformed and wrong-app events', async (t) => {
  const f = await fixture(t)
  for (const headers of [{ 'x-signature-ed25519': '' }, { 'x-bot-appid': 'other' }, { 'x-signature-ed25519': '00'.repeat(64) }]) {
    assert.equal((await f.post(event(), headers)).status, 401)
  }
  const raw = JSON.stringify(event())
  assert.equal((await f.post(raw, { 'x-signature-timestamp': '1', 'x-signature-ed25519': signer.sign('1', raw) })).status, 401)
  assert.equal((await f.post('{')).status, 400)
  assert.equal((await f.post({ op: 13, d: { plain_token: 1 } })).status, 400)
  assert.equal((await f.post('null')).status, 400)
  assert.equal(f.handled.length, 0)
})

test('unsigned challenge cannot be used as a signing oracle for forged message events', async (t) => {
  const f = await fixture(t)
  const forged = JSON.stringify({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'forged',
      group_openid: 'g1',
      author: { member_openid: 'u1' },
      content: 'attack',
    },
  })
  assert.ok(forged.length < 256)
  const response = await fetch(`${f.url}/webhook/qq`, {
    method: 'POST',
    headers: { 'x-bot-appid': appId, 'content-type': 'application/json' },
    body: JSON.stringify({ op: 13, d: { plain_token: forged, event_ts: timestamp } }),
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).signature, undefined)
  assert.equal(f.handled.length, 0)
})

test('normalizes only official group @ events; dedupes different delivery IDs of one message', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await (await f.post(event())).json(), { op: 12 })
  await f.handler.drain()
  await f.post({ ...event(), id: 'redelivery-id' })
  await f.post({ ...event('m2'), t: 'GROUP_MESSAGE_CREATE' })
  await f.post({ ...event('m3'), t: 'C2C_MESSAGE_CREATE' })
  await f.post(event('m4', { author: { member_openid: 'u1', bot: true } }))
  await f.post(event('m5', { content: '', attachments: [{ url: 'image' }] }))
  await f.handler.drain()
  assert.deepEqual(f.handled, [{ platform: 'qq-official', botId: appId, groupId: 'g1', userId: 'u1', messageId: 'm1', text: '你好' }])
  assert.equal(f.sent.length, 1)
})

test('allowlist uses official group openid and validates required message IDs', async (t) => {
  const f = await fixture(t, { groupAllowlist: ['allowed'] })
  await f.post(event())
  await f.post(event('m2', { group_openid: 'allowed', author: {} }))
  await f.post(event('m3', { group_openid: 'allowed' }))
  await f.handler.drain()
  assert.deepEqual(
    f.handled.map((m) => m.messageId),
    ['m3'],
  )
})

test('ACK does not await AI; duplicate in flight is ACKed and overload is retryable', async (t) => {
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, {
    maxPending: 1,
    handleMessage: async () => {
      await wait
      return 'done'
    },
  })
  t.after(release)
  try {
    assert.equal((await f.post(event())).status, 200)
    assert.equal(f.sent.length, 0)
    assert.equal((await f.post(event())).status, 200)
    assert.equal((await f.post(event('m2'))).status, 503)
  } finally {
    release()
  }
  await f.handler.drain()
  assert.equal(f.sent.length, 1)
  assert.equal((await f.post(event('m2'))).status, 200)
})

test('body size is bounded and shutdown rejects new work', async (t) => {
  const f = await fixture(t, { maxBodyBytes: 500 })
  assert.equal((await f.post(event('m1', { content: 'x'.repeat(600) }))).status, 413)
  f.handler.close()
  assert.equal((await f.post(event())).status, 503)
})

test('send failure is caught and a duplicate does not regenerate a possibly delivered reply', async (t) => {
  const f = await fixture(t, {
    sendReply: async () => {
      throw new Error('upstream failed')
    },
  })
  await f.post(event())
  await f.handler.drain()
  await f.post(event())
  await f.handler.drain()
  assert.equal(f.handled.length, 1)
  assert.equal(f.errors.length, 1)
})

test('dedup expires completed entries and bounds capacity without dropping active entries', async (t) => {
  let clock = Date.now(),
    release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const handled = []
  const f = await fixture(t, {
    now: () => clock,
    dedupTtlMs: 100,
    maxDedupEntries: 1,
    maxPending: 3,
    handleMessage: async (message) => {
      handled.push(message.messageId)
      if (handled.length === 1) await wait
      return 'done'
    },
  })
  try {
    assert.equal((await f.post(event())).status, 200)
    assert.equal((await f.post(event('m2'))).status, 503)
    clock += 101
    assert.equal((await f.post(event())).status, 200)
    assert.deepEqual(handled, ['m1'])
  } finally {
    release()
  }
  await f.handler.drain()
  assert.equal((await f.post(event())).status, 200)
  await f.handler.drain()
  assert.deepEqual(handled, ['m1'])
  clock += 101
  await f.post(event())
  await f.handler.drain()
  assert.deepEqual(handled, ['m1', 'm1'])
  await f.post(event('m2'))
  await f.handler.drain()
  assert.deepEqual(handled, ['m1', 'm1', 'm2'])
})

test('shutdown rejects a callback whose body was still arriving when close began', async () => {
  let calls = 0,
    status,
    finish
  const done = new Promise((resolve) => {
    finish = resolve
  })
  const handler = createQQWebhook({
    appId,
    appSecret,
    handleMessage: async () => {
      calls++
      return 'hi'
    },
    sendReply: async () => {},
  })
  const raw = JSON.stringify(event())
  const request = new PassThrough()
  Object.assign(request, {
    url: '/webhook/qq',
    method: 'POST',
    headers: {
      'x-bot-appid': appId,
      'x-signature-timestamp': timestamp,
      'x-signature-ed25519': signer.sign(timestamp, raw),
    },
  })
  handler(request, {
    writeHead(code) {
      status = code
    },
    end() {
      finish()
    },
  })
  request.write(raw.slice(0, 20))
  handler.close()
  request.end(raw.slice(20))
  await done
  await handler.drain()
  assert.equal(status, 503)
  assert.equal(calls, 0)
})
