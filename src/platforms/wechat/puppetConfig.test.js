import assert from 'node:assert/strict'
import { test } from 'node:test'
import { env } from '../../config/env.js'
import { createWechatBot } from './bot.js'

function withWechatEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]))
  try {
    Object.assign(env, values)
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
}

test('Puppet Service mode requires a token before starting the bot', () => {
  withWechatEnv({ WECHAT_TRANSPORT: 'service', WECHATY_PUPPET_SERVICE_TOKEN: '' }, () => {
    assert.throws(() => createWechatBot(), /WECHATY_PUPPET_SERVICE_TOKEN/)
  })
})

test('Puppet Service mode passes token and endpoint to Wechaty', () => {
  withWechatEnv(
    {
      WECHAT_TRANSPORT: 'service',
      WECHATY_PUPPET_SERVICE_TOKEN: 'test-token',
      WECHATY_PUPPET_SERVICE_ENDPOINT: 'localhost:8788',
      WECHAT_LOGIN_DEBUG: 'true',
    },
    () => {
      const bot = createWechatBot()
      assert.equal(bot.__options.puppet, 'wechaty-puppet-service')
      assert.deepEqual(bot.__options.puppetOptions, { token: 'test-token', endpoint: 'localhost:8788' })
      assert.equal(bot.__options.name, 'WechatEveryDay-service')
    },
  )
})

test('default transport still uses wechat4u', () => {
  withWechatEnv({ WECHAT_TRANSPORT: '', WECHAT_LOGIN_DEBUG: 'false' }, () => {
    const bot = createWechatBot()
    assert.equal(bot.__options.puppet, 'wechaty-puppet-wechat4u')
  })
})

test('unknown transport fails instead of silently using wechat4u', () => {
  withWechatEnv({ WECHAT_TRANSPORT: 'unknown' }, () => {
    assert.throws(() => createWechatBot(), /WECHAT_TRANSPORT/)
  })
})
