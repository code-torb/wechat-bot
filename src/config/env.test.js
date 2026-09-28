import assert from 'node:assert/strict'
import { test } from 'node:test'
import { env, getWechatRuntimeConfig } from './env.js'

test('reads the selected WeChat transport and Puppet Service connection', () => {
  const keys = ['WECHAT_TRANSPORT', 'WECHATY_PUPPET_SERVICE_TOKEN', 'WECHATY_PUPPET_SERVICE_ENDPOINT']
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]))

  try {
    env.WECHAT_TRANSPORT = 'service'
    env.WECHATY_PUPPET_SERVICE_TOKEN = 'test-token'
    env.WECHATY_PUPPET_SERVICE_ENDPOINT = 'localhost:8788'

    const config = getWechatRuntimeConfig()
    assert.equal(config.transport, 'service')
    assert.equal(config.puppetServiceToken, 'test-token')
    assert.equal(config.puppetServiceEndpoint, 'localhost:8788')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete env[key]
      else env[key] = previous[key]
    }
  }
})
