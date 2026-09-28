import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { createChatProvider } from './provider.js'

async function readRequestBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
  }
  return body ? JSON.parse(body) : null
}

async function withServer(handler, run) {
  const server = http.createServer(handler)
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

test('sends OpenAI-compatible chat completions request and returns trimmed text', async () => {
  let requestDetails

  await withServer(
    async (request, response) => {
      requestDetails = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: await readRequestBody(request),
      }
      jsonResponse(response, 200, {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '  你好  ' },
          },
        ],
      })
    },
    async (baseURL) => {
      const complete = createChatProvider({
        apiKey: 'test-key',
        baseURL: `${baseURL}/compatible/v1`,
        model: 'qq-model',
        timeoutMs: 1000,
        maxTokens: 123,
      })

      const reply = await complete([{ role: 'user', content: 'hi' }])

      assert.equal(reply, '你好')
      assert.equal(requestDetails.method, 'POST')
      assert.equal(requestDetails.url, '/compatible/v1/chat/completions')
      assert.equal(requestDetails.authorization, 'Bearer test-key')
      assert.equal(requestDetails.body.model, 'qq-model')
      assert.deepEqual(requestDetails.body.messages, [{ role: 'user', content: 'hi' }])
      assert.equal(requestDetails.body.max_tokens, 123)
    },
  )
})

test('validates required provider options', () => {
  assert.throws(() => createChatProvider({ apiKey: '', baseURL: 'http://127.0.0.1', model: 'm' }), /apiKey/)
  assert.throws(() => createChatProvider({ apiKey: 'k', baseURL: 'not a url', model: 'm' }), /baseURL/)
  assert.throws(() => createChatProvider({ apiKey: 'k', baseURL: 'http://127.0.0.1', model: '' }), /model/)
  assert.throws(() => createChatProvider({ apiKey: 'k', baseURL: 'http://127.0.0.1', model: 'm', timeoutMs: 0 }), /timeoutMs/)
  assert.throws(() => createChatProvider({ apiKey: 'k', baseURL: 'http://127.0.0.1', model: 'm', maxTokens: 0 }), /maxTokens/)
})

test('rejects when the provider times out', async () => {
  await withServer(
    (_request, response) => {
      setTimeout(() => {
        jsonResponse(response, 200, {
          choices: [{ message: { role: 'assistant', content: '太晚了' } }],
        })
      }, 200)
    },
    async (baseURL) => {
      const complete = createChatProvider({
        apiKey: 'test-key',
        baseURL,
        model: 'qq-model',
        timeoutMs: 50,
      })

      await assert.rejects(() => complete([{ role: 'user', content: 'hi' }]), /timed out|timeout|aborted/i)
    },
  )
})

test('rejects empty or invalid provider output', async () => {
  const invalidBodies = [
    { choices: [] },
    { choices: [{ message: { role: 'assistant', content: '' } }] },
    { choices: [{ message: { role: 'assistant', content: null } }] },
  ]

  for (const body of invalidBodies) {
    await withServer(
      (_request, response) => {
        jsonResponse(response, 200, body)
      },
      async (baseURL) => {
        const complete = createChatProvider({
          apiKey: 'test-key',
          baseURL,
          model: 'qq-model',
          timeoutMs: 1000,
        })

        await assert.rejects(() => complete([{ role: 'user', content: 'hi' }]), /empty|invalid/i)
      },
    )
  }
})
