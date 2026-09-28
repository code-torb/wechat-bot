import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { getChatConfig } from './config.js'

const chatEnv = { CHAT_API_KEY: 'key', CHAT_MODEL: 'model' }

test('CHAT config works without QQ credentials and preserves defaults', () => {
  const config = getChatConfig({ ...chatEnv })

  assert.deepEqual(config.provider, {
    apiKey: 'key',
    model: 'model',
    baseURL: 'https://api.openai.com/v1',
    timeoutMs: 45000,
    maxTokens: 1000,
  })
  assert.deepEqual(config.core, {
    systemPrompt: '你是一个友好、简洁的中文聊天助手。请用纯文本回答，避免过长的回复。',
    maxTurns: 10,
    sessionTtlMs: 1800000,
    maxSessions: 1000,
    cooldownMs: 2000,
    maxConcurrent: 4,
    maxInputChars: 4000,
    maxReplyChars: 1500,
  })
})

test('CHAT config validates required credentials and shared numeric settings', () => {
  assert.throws(() => getChatConfig({}), /CHAT_API_KEY.*CHAT_MODEL/)

  for (const [key, value] of [
    ['CHAT_MAX_TURNS', '0'],
    ['CHAT_MAX_CONCURRENT', '-1'],
    ['CHAT_TIMEOUT_MS', '300000'],
    ['CHAT_MAX_INPUT_CHARS', '2.5'],
    ['CHAT_MAX_REPLY_CHARS', '10'],
  ]) {
    assert.throws(() => getChatConfig({ ...chatEnv, [key]: value }), new RegExp(key))
  }

  assert.throws(() => getChatConfig({ ...chatEnv, CHAT_BASE_URL: 'file:///tmp/model' }), /CHAT_BASE_URL/)
})

test('CHAT config supports legacy OpenAI fallbacks and local model URL', () => {
  const config = getChatConfig({
    OPENAI_API_KEY: 'old-key',
    OPENAI_MODEL: 'old-model',
    OPENAI_PROXY_URL: 'http://127.0.0.1:11434/v1',
  })

  assert.equal(config.provider.apiKey, 'old-key')
  assert.equal(config.provider.model, 'old-model')
  assert.equal(config.provider.baseURL, 'http://127.0.0.1:11434/v1')
})

test('CHAT prompt file overrides inline prompt and validates file content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-config-'))
  try {
    const path = join(dir, 'prompt.txt')
    writeFileSync(path, '你是群里的猫。\n简短回答。\n')

    assert.equal(
      getChatConfig({ ...chatEnv, CHAT_SYSTEM_PROMPT: 'inline', CHAT_SYSTEM_PROMPT_FILE: path }).core.systemPrompt,
      '你是群里的猫。\n简短回答。',
    )

    writeFileSync(path, ' ')
    assert.throws(() => getChatConfig({ ...chatEnv, CHAT_SYSTEM_PROMPT_FILE: path }), /CHAT_SYSTEM_PROMPT_FILE/)
    assert.throws(() => getChatConfig({ ...chatEnv, CHAT_SYSTEM_PROMPT_FILE: join(dir, 'missing') }), /CHAT_SYSTEM_PROMPT_FILE/)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
