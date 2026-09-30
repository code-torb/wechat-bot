import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNapCatConnection } from './napcat-connection.js'

test('adds only the managed WebSocket and never exposes its token', async () => {
  let config = {
    feature: { sideEffects: false },
    network: {
      websocketServers: [],
      httpServers: [{ name: 'other-service', port: 8080 }],
    },
  }
  const webui = {
    oneBotConfig: async () => config,
    setOneBotConfig: async (next) => {
      config = next
    },
  }
  const connection = createNapCatConnection({ webui, accessToken: 'private-onebot-token', wsUrl: 'ws://napcat:3001' })
  const initial = await connection.status()
  assert.equal(initial.ready, false)
  const result = await connection.ensureWebSocket(initial.revision)
  assert.equal(result.ready, true)
  assert.equal(result.port, 3001)
  assert.equal(JSON.stringify(result).includes('private-onebot-token'), false)
  assert.deepEqual(config.network.httpServers, [{ name: 'other-service', port: 8080 }])
  assert.deepEqual(config.feature, { sideEffects: false })
  assert.equal(config.network.websocketServers[0].messagePostFormat, 'array')
  assert.equal(config.network.websocketServers[0].token, 'private-onebot-token')
  await assert.rejects(connection.ensureWebSocket(initial.revision), { code: 'CONFLICT', statusCode: 409 })
})

test('does not overwrite a different WebSocket service occupying the management port', async () => {
  const config = { network: { websocketServers: [{ name: 'another-bot', enable: true, host: '0.0.0.0', port: 3001, token: 'another-token' }] } }
  const webui = {
    oneBotConfig: async () => config,
    setOneBotConfig: async () => {
      throw new Error('must not change')
    },
  }
  const connection = createNapCatConnection({ webui, accessToken: 'ours', wsUrl: 'ws://napcat:3001' })
  const initial = await connection.status()
  await assert.rejects(connection.ensureWebSocket(initial.revision), { code: 'PORT_IN_USE', statusCode: 409 })
  assert.equal(JSON.stringify(initial).includes('another-token'), false)
})
