import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('start --serve selects the requested service without opening a prompt', () => {
  const result = spawnSync(process.execPath, ['./cli.js', 'start', '--serve', 'pi'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      SERVICE_TYPE: '',
      WECHAT_TRANSPORT: 'service',
      WECHATY_PUPPET_SERVICE_TOKEN: '',
    },
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout + result.stderr, /WECHATY_PUPPET_SERVICE_TOKEN/)
  assert.doesNotMatch(result.stdout + result.stderr, /请先选择服务类型/)
})
