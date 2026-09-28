import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getOneBotConfig } from './config.js'

const base = { ONEBOT_ACCESS_TOKEN: 'test-token', ONEBOT_GROUP_ALLOWLIST: '34567, 45678', CHAT_API_KEY: 'key', CHAT_MODEL: 'model' }

test('personal QQ requires no official credentials and shares chat settings', () => {
  const c = getOneBotConfig(base)
  assert.equal(c.client.url, 'ws://127.0.0.1:3001/')
  assert.equal(c.client.accessToken, 'test-token')
  assert.deepEqual(c.messages.groupAllowlist, ['34567', '45678'])
  assert.equal(c.provider.model, 'model')
  assert.equal(c.core.maxTurns, 10)
  assert.equal(c.client.expectedSelfId, '')
})

test('requires explicit token and group scope before connecting', () => {
  assert.throws(() => getOneBotConfig({ CHAT_API_KEY: 'key', CHAT_MODEL: 'model' }), /ONEBOT_ACCESS_TOKEN.*ONEBOT_GROUP_ALLOWLIST/)
  for (const group of ['all', 'abc', '0', '9007199254740993', ', ,']) {
    assert.throws(() => getOneBotConfig({ ...base, ONEBOT_GROUP_ALLOWLIST: group }), /ONEBOT_GROUP_ALLOWLIST/)
  }
  assert.throws(() => getOneBotConfig({ ...base, ONEBOT_ACCESS_TOKEN: 'bad\ntoken' }), /ONEBOT_ACCESS_TOKEN/)
})

test('validates WS URLs without URL credentials, optional identity and limits', () => {
  assert.equal(getOneBotConfig({ ...base, ONEBOT_WS_URL: 'ws://napcat:3001', ONEBOT_SELF_ID: '12345' }).client.expectedSelfId, '12345')
  for (const url of [
    'http://localhost:3001',
    'ws://u:p@localhost',
    'ws://localhost?access_token=secret',
    'ws://localhost/api',
    'ws://localhost/event',
  ]) {
    assert.throws(() => getOneBotConfig({ ...base, ONEBOT_WS_URL: url }), /ONEBOT_WS_URL/)
  }
  assert.throws(() => getOneBotConfig({ ...base, ONEBOT_SELF_ID: 'name' }), /ONEBOT_SELF_ID/)
  for (const [key, value] of [
    ['ONEBOT_MAX_PENDING', '0'],
    ['ONEBOT_RECONNECT_MS', '-1'],
    ['ONEBOT_REQUEST_TIMEOUT_MS', 'Infinity'],
  ]) {
    assert.throws(() => getOneBotConfig({ ...base, [key]: value }), new RegExp(key))
  }
})
