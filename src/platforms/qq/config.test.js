import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getQQConfig } from './config.js'

const env = { QQ_APP_ID: 'app', QQ_APP_SECRET: 'secret', CHAT_API_KEY: 'key', CHAT_MODEL: 'model' }

test('QQ defaults are independent of existing single-turn service settings', () => {
  const config = getQQConfig({ ...env, SERVICE_TYPE: 'pi', BOT_NAME: '@微信' })
  assert.equal(config.qq.appId, 'app')
  assert.equal(config.qq.apiBaseURL, 'https://api.bot.qq.com')
  assert.equal(config.server.host, '127.0.0.1')
  assert.equal(config.server.port, 3001)
  assert.equal(config.provider.model, 'model')
  assert.equal(config.core.maxTurns, 10)
})

test('missing credentials and invalid numeric settings fail early with config names', () => {
  assert.throws(() => getQQConfig({}), /QQ_APP_ID.*QQ_APP_SECRET.*CHAT_API_KEY.*CHAT_MODEL/)
  for (const [key, value] of [
    ['QQ_WEBHOOK_PORT', '0'],
    ['QQ_WEBHOOK_PORT', '65536'],
    ['CHAT_MAX_TURNS', 'NaN'],
    ['CHAT_MAX_CONCURRENT', '-1'],
    ['CHAT_TIMEOUT_MS', '300000'],
    ['CHAT_MAX_INPUT_CHARS', '2.5'],
  ]) {
    assert.throws(() => getQQConfig({ ...env, [key]: value }), new RegExp(key))
  }
  assert.throws(() => getQQConfig({ ...env, QQ_WEBHOOK_PATH: '/healthz' }), /QQ_WEBHOOK_PATH/)
  assert.throws(() => getQQConfig({ ...env, CHAT_BASE_URL: 'file:///tmp/model' }), /CHAT_BASE_URL/)
})

test('supports legacy OpenAI fallbacks and CSV official group openids', () => {
  const c = getQQConfig({
    QQ_APP_ID: 'app',
    QQ_APP_SECRET: 'secret',
    OPENAI_API_KEY: 'oldkey',
    OPENAI_MODEL: 'oldmodel',
    OPENAI_PROXY_URL: 'http://127.0.0.1:11434/v1',
    QQ_GROUP_ALLOWLIST: 'g1, g2, ,',
  })
  assert.equal(c.provider.apiKey, 'oldkey')
  assert.equal(c.provider.model, 'oldmodel')
  assert.equal(c.provider.baseURL, 'http://127.0.0.1:11434/v1')
  assert.deepEqual(c.webhook.groupAllowlist, ['g1', 'g2'])
})

test('UTF-8 prompt file overrides inline prompt and unreadable/empty files fail early', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-config-'))
  try {
    const path = join(dir, 'prompt.txt')
    writeFileSync(path, '你是群里的猫。\n简短回答。\n')
    assert.equal(getQQConfig({ ...env, CHAT_SYSTEM_PROMPT: 'inline', CHAT_SYSTEM_PROMPT_FILE: path }).core.systemPrompt, '你是群里的猫。\n简短回答。')
    writeFileSync(path, ' ')
    assert.throws(() => getQQConfig({ ...env, CHAT_SYSTEM_PROMPT_FILE: path }), /CHAT_SYSTEM_PROMPT_FILE/)
    assert.throws(() => getQQConfig({ ...env, CHAT_SYSTEM_PROMPT_FILE: join(dir, 'missing') }), /CHAT_SYSTEM_PROMPT_FILE/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
