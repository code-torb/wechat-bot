import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startQQAgent } from './agent.js'
import { getQQConfig } from './config.js'
import { createQQSigner } from './signature.js'

test('runtime connects signed QQ messages to multi-turn chat and drains on shutdown', async () => {
  const config = getQQConfig({ QQ_APP_ID: 'app', QQ_APP_SECRET: 'secret', CHAT_API_KEY: 'key', CHAT_MODEL: 'model', CHAT_COOLDOWN_MS: '0' })
  config.server.port = 0
  const prompts = [],
    sent = []
  const runtime = await startQQAgent({
    config,
    installSignalHandlers: false,
    logger: { log() {}, error() {} },
    complete: async (messages) => {
      prompts.push(messages)
      return 'answer'
    },
    api: {
      sendReply: async (message, text) => {
        sent.push({ message, text })
      },
    },
  })
  try {
    const url = `http://127.0.0.1:${runtime.server.address().port}`
    const signer = createQQSigner('secret')
    for (const [id, content] of [
      ['1', 'hello'],
      ['2', 'continue'],
      ['3', '/reset'],
      ['4', 'new chat'],
    ]) {
      const body = JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: { id, content, group_openid: 'group', author: { member_openid: 'user' } },
      })
      const ts = String(Math.floor(Date.now() / 1000))
      const response = await fetch(`${url}/webhook/qq`, {
        method: 'POST',
        headers: { 'x-bot-appid': 'app', 'x-signature-timestamp': ts, 'x-signature-ed25519': signer.sign(ts, body) },
        body,
      })
      assert.equal(response.status, 200)
      await runtime.handler.drain()
    }
    assert.deepEqual(
      prompts.map((p) => p.map((m) => m.role)),
      [
        ['system', 'user'],
        ['system', 'user', 'assistant', 'user'],
        ['system', 'user'],
      ],
    )
    assert.equal(sent.length, 4)
    assert.equal(sent[0].message.groupId, 'group')
  } finally {
    await runtime.stop()
  }
  assert.equal(runtime.server.listening, false)
})
