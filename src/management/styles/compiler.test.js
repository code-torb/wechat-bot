import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createStyleRepository, StyleConflictError } from './repository.js'
import { compileStyles, compileStyleValue, validateStyleDefinition, validateAgentPacing } from './compiler.js'

test('custom style definition compiles into bounded behavior text', () => {
  const { systemText, appliedStyles } = compileStyles({
    prompt: '你是一个聊天伙伴。',
    definitions: [
      {
        key: 'curiosity',
        name: '好奇程度',
        value: 0.7,
        lowText: '回答后自然收尾',
        midText: '必要时追问',
        highText: '更主动探索意图',
        enabled: true,
      },
    ],
  })
  assert.equal(appliedStyles.length, 1)
  assert.match(systemText, /好奇程度 0\.70/)
  assert.match(systemText, /更主动探索意图/)
  assert.match(systemText, /更接近高值/)
})

test('disabled styles are skipped and values outside 0-1 are rejected', () => {
  const skipped = compileStyles({
    prompt: 'p',
    definitions: [{ key: 'x', name: 'x', value: 0.5, lowText: 'l', midText: 'm', highText: 'h', enabled: false }],
  })
  assert.equal(skipped.appliedStyles.length, 0)
  assert.equal(skipped.systemText, 'p')
  assert.throws(() => compileStyleValue({ name: 'x', value: 1.01, lowText: 'l', midText: 'm', highText: 'h' }), /between 0 and 1/)
  assert.throws(() => compileStyles({ prompt: 'p', definitions: Array(21).fill({}) }), /at most 20/)
})

test('definition validation clamps default and pacing accepts null', () => {
  const definition = validateStyleDefinition({
    key: 'k',
    name: '名称',
    defaultValue: 0.5,
    lowText: 'l',
    midText: 'm',
    highText: 'h',
  })
  assert.equal(definition.defaultValue, 0.5)
  assert.equal(validateAgentPacing(null), null)
  assert.throws(() => validateAgentPacing({ baseDelayMs: 1, charsPerSecond: 0, maxDelayMs: 0 }))
})

test('repository: duplicate global key rejected, agent value update keeps history, disable bumps activation', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'style-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  const repo = createStyleRepository(db)
  const created = repo.create({
    key: 'curiosity',
    name: '好奇程度',
    defaultValue: 0.5,
    lowText: '收尾',
    midText: '追问',
    highText: '探索',
  })
  assert.throws(() => repo.create({ key: 'curiosity', name: 'x', defaultValue: 0.5, lowText: 'l', midText: 'm', highText: 'h' }), StyleConflictError)
  db.prepare('INSERT INTO agents (id, name, status, draft_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(
    'agent-a',
    'A',
    'draft',
    '{}',
    Date.now(),
    Date.now(),
  )
  repo.setAgentValue({ agentId: 'agent-a', definitionId: created.id, definitionVersionId: created.versionId, value: 0.2 })
  const before = repo.agentValues('agent-a')[0].value
  assert.equal(before, 0.2)
  const secondVersion = repo.addVersion({
    definitionId: created.id,
    name: '好奇程度',
    defaultValue: 0.6,
    lowText: '收尾',
    midText: '追问',
    highText: '探索',
  })
  repo.setAgentValue({ agentId: 'agent-a', definitionId: created.id, definitionVersionId: secondVersion.id, value: 0.3 })
  assert.equal(repo.agentValues('agent-a')[0].value, 0.3)
  assert.equal(repo.agentValues('agent-a')[0].definition_version_id, secondVersion.id)
  const disabled = repo.setEnabled({ definitionId: created.id, enabled: false })
  assert.equal(disabled.enabled, 0)
  assert.equal(disabled.activation_generation, 2)
  assert.throws(
    () => repo.setAgentValue({ agentId: 'agent-a', definitionId: created.id, definitionVersionId: secondVersion.id, value: 0.4 }),
    /disabled/,
  )
})
