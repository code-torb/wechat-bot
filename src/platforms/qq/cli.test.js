import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('QQ has a dedicated CLI without loading WeChat or opening model prompt', () => {
  const help = spawnSync(process.execPath, ['cli.js', 'qq', 'official', '--help'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /QQ/)
  const result = spawnSync(process.execPath, ['cli.js', 'qq', 'official'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, QQ_APP_ID: '', QQ_APP_SECRET: '', CHAT_API_KEY: '', OPENAI_API_KEY: '', CHAT_MODEL: '', OPENAI_MODEL: '' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /QQ_APP_ID/)
  assert.doesNotMatch(result.stdout + result.stderr, /请先选择服务类型|Wechaty|QRCode/)
})
