import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createCommandRegistry } from './registry.js'
import { executeCommand } from './executor.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'commands-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const now = Date.now()
  db.prepare('INSERT INTO command_definitions (id, name, status, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    'cmd-a',
    'rules',
    'active',
    now,
    now,
  )
  db.prepare(
    'INSERT INTO command_versions (id, command_id, version, aliases_json, input_schema_json, execution_type, steps_json, capabilities_json, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)',
  ).run('cmd-a1', 'cmd-a', '["rules"]', '{}', 'static', JSON.stringify([{ text: '规则：友好交流。' }]), '[]', now)
  db.prepare('INSERT INTO command_definitions (id, name, status, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    'cmd-b',
    'translate',
    'active',
    now,
    now,
  )
  db.prepare(
    'INSERT INTO command_versions (id, command_id, version, aliases_json, input_schema_json, execution_type, steps_json, capabilities_json, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)',
  ).run('cmd-b1', 'cmd-b', '[]', '{}', 'model_task', JSON.stringify([{ template: '把下面内容翻译成英文：{args}' }]), '[]', now)
  return { db, registry: createCommandRegistry({ db }) }
}

test('builtin help and reset match and unknown commands report help', (t) => {
  const { registry } = fixture(t)
  const agentVersion = { commandRefs: ['cmd-a', 'cmd-b'] }
  assert.equal(registry.match(agentVersion, '/help').builtin, 'help')
  assert.equal(registry.match(agentVersion, '/reset').builtin, 'reset')
  assert.equal(registry.match(agentVersion, '/rules').commandId, 'cmd-a')
  assert.equal(registry.match(agentVersion, '别名'.length ? '/rules' : '/x').name, '/rules')
  assert.equal(registry.match(agentVersion, '/unknown'), null)
  assert.equal(registry.match(agentVersion, '普通消息'), null)
})

test('executor enforces command capabilities and limits workflows to five steps', (t) => {
  const { registry } = fixture(t)
  const agentVersion = { commandRefs: ['cmd-a', 'cmd-b'] }
  const policy = {
    authorize: ({ capability }) => ({ allowed: capability !== 'files.update' }),
  }
  const help = executeCommand({
    command: registry.match(agentVersion, '/help'),
    args: [],
    policy,
    helpItems: [{ name: '/rules', description: '查看规则' }],
  })
  assert.match(help.text, /\/rules/)
  const rules = executeCommand({ command: registry.match(agentVersion, '/rules'), args: [], policy, helpItems: [] })
  assert.deepEqual(rules, { type: 'text', text: '规则：友好交流。' })
  const translate = executeCommand({ command: registry.match(agentVersion, '/translate'), args: ['你好'], policy, helpItems: [] })
  assert.equal(translate.type, 'model_task')
  const workflow = executeCommand({
    command: { executionType: 'workflow', capabilities: ['files.update'], steps: Array(6).fill({}) },
    args: [],
    policy,
    helpItems: [],
  })
  assert.equal(workflow.type, 'denied')
})
