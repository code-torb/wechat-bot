import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('qq agent now starts personal QQ and reports OneBot config, not official credentials', () => {
  const help = spawnSync(process.execPath, ['cli.js', 'qq', 'agent', '--help'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /NapCat|OneBot/)
  const result = spawnSync(process.execPath, ['cli.js', 'qq', 'agent'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ONEBOT_ACCESS_TOKEN: '', ONEBOT_GROUP_ALLOWLIST: '', QQ_APP_ID: '', QQ_APP_SECRET: '' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ONEBOT_ACCESS_TOKEN.*ONEBOT_GROUP_ALLOWLIST/)
  assert.doesNotMatch(result.stderr, /QQ_APP_ID|QQ_APP_SECRET|请先选择服务类型/)
})
