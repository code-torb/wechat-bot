import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQQApi } from './api.js'

const response = (data, status = 200) => new Response(JSON.stringify(data), { status })
const message = { groupId: 'group/one', messageId: 'source-message' }

test('shares cached token and sends passive group reply with original message ID', async () => {
  const calls = []
  const api = createQQApi({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), ...init, body: JSON.parse(init.body) })
      return url.endsWith('getAppAccessToken') ? response({ access_token: 'token', expires_in: '7200' }) : response({ id: 'reply' })
    },
  })
  await Promise.all([api.sendReply(message, '你好'), api.sendReply(message, '你好')])
  assert.equal(calls.filter((c) => c.url.endsWith('getAppAccessToken')).length, 1)
  const send = calls.find((c) => c.url.includes('/messages'))
  assert.equal(send.url, 'https://api.bot.qq.com/v2/groups/group%2Fone/messages')
  assert.equal(send.headers.Authorization, 'QQBot token')
  assert.deepEqual(send.body, { content: '你好', msg_type: 0, msg_id: 'source-message', msg_seq: 1 })
  assert.deepEqual(calls[0].body, { appId: 'app', clientSecret: 'secret' })
})

test('refreshes near expiry and refreshes once after an HTTP 401', async () => {
  let now = 0,
    tokens = 0,
    sends = 0
  const api = createQQApi({
    appId: 'app',
    appSecret: 'secret',
    now: () => now,
    fetchImpl: async (url) => {
      if (url.endsWith('getAppAccessToken')) return response({ access_token: `token${++tokens}`, expires_in: 120 })
      sends++
      return sends === 2 ? response({ message: 'private upstream text' }, 401) : response({ id: 'reply' })
    },
  })
  await api.sendReply(message, 'first')
  await api.sendReply(message, 'second')
  assert.equal(tokens, 2)
  assert.equal(sends, 3)
  now = 61000
  await api.sendReply(message, 'third')
  assert.equal(tokens, 3)
})

test('token business errors, send errors and network errors are sanitized without retries', async () => {
  for (const tokenFailure of [true, false]) {
    let sends = 0
    const api = createQQApi({
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: async (url) => {
        if (url.endsWith('getAppAccessToken'))
          return tokenFailure ? response({ code: 100016, message: 'secret-value' }) : response({ access_token: 'token', expires_in: 7200 })
        sends++
        return response({ code: 40054010, message: 'secret-value' }, 400)
      },
    })
    await assert.rejects(api.sendReply(message, 'hello'), (error) => {
      assert.doesNotMatch(error.message, /secret-value/)
      assert.match(error.message, /100016|40054010/)
      return true
    })
    assert.equal(sends, tokenFailure ? 0 : 1)
  }
  const api = createQQApi({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: async () => {
      throw new Error('secret-value')
    },
  })
  await assert.rejects(api.sendReply(message, 'hello'), (error) => !error.message.includes('secret-value'))
})

test('HTTP 401 only retries once, other statuses never blindly resend', async () => {
  let sends = 0
  const api = createQQApi({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: async (url) => {
      if (url.endsWith('getAppAccessToken')) return response({ access_token: 'token', expires_in: 7200 })
      sends++
      return response({}, 401)
    },
  })
  await assert.rejects(api.sendReply(message, 'hello'), /401/)
  assert.equal(sends, 2)
})

test('HTTP 200 err_code failures are rejected, as specified by current QQ API guide', async () => {
  const api = createQQApi({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: async (url) =>
      url.endsWith('getAppAccessToken')
        ? response({ access_token: 'token', expires_in: 7200 })
        : response({ err_code: 40054010, message: 'secret-value' }),
  })
  await assert.rejects(api.sendReply(message, 'hi'), /40054010/)
})
