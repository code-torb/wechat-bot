import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SecretStore } from '../management/secrets/store.js'
import { createModelClient } from './model-client.js'

test('management model client returns replies with provider usage', async () => {
  const secretStore = new SecretStore({ key: Buffer.alloc(32, 7) })
  const record = { id: 'model-a', aad_kind: 'model', key_version: 1 }
  const credentialRow = { ...record, ...secretStore.encrypt({ record, plaintext: 'test-key' }) }
  let requestBody
  const complete = createModelClient({ secretStore })
  const result = await complete({
    model: { ...credentialRow, base_url: 'https://example.test/v1' },
    modelName: 'deepseek-chat',
    messages: [{ role: 'user', content: '你好' }],
    transport: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return new Response(
        JSON.stringify({
          id: 'reply-1',
          object: 'chat.completion',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '你好！' } }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  assert.equal(requestBody.model, 'deepseek-chat')
  assert.deepEqual(result, { text: '你好！', toolCalls: [], usage: { inputTokens: 4, outputTokens: 2 } })
})
